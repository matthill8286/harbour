// Splits the output of `pnpm deploy` into the files each image needs.
//   node split-modules.cjs <app dir> <cli dir>
// <app dir> keeps what the api loads at run time: the packages reachable from its
// "dependencies". Packages that only the Prisma CLI needs move to <cli dir>, which the
// migrate image adds as one extra layer. Anything neither one reaches is deleted.
// Optional peer dependencies (prisma and typescript, for @prisma/client) are not
// followed, which is what keeps them out of the api image.
const fs = require('node:fs');
const path = require('node:path');

const app = fs.realpathSync(process.argv[2]);
const cli = path.resolve(process.argv[3]);
const modules = path.join(app, 'node_modules');
const store = path.join(modules, '.pnpm');

const manifest = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

/** The real directory of `name` as Node would resolve it from `from`. */
function locate(from, name) {
  for (let dir = from; dir.startsWith(app); dir = path.dirname(dir)) {
    const candidate =
      path.basename(dir) === 'node_modules'
        ? path.join(dir, name)
        : path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return fs.realpathSync(candidate);
    }
  }
  return null;
}

/** The .pnpm entry that holds a package directory. */
const entryOf = (dir) => path.relative(store, dir).split(path.sep)[0];

/** The .pnpm entries reachable from the named packages. */
function closure(from, names) {
  const seen = new Set();
  const queue = names.map(([name, required]) => [from, name, required]);
  while (queue.length) {
    const [parent, name, required] = queue.pop();
    const dir = locate(parent, name);
    if (!dir) {
      if (required) throw new Error(`Cannot find ${name} from ${parent}`);
      continue;
    }
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pkg = manifest(dir);
    const optionalPeer = (peer) => pkg.peerDependenciesMeta?.[peer]?.optional;
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      queue.push([dir, dep, !(dep in (pkg.optionalDependencies ?? {}))]);
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      queue.push([dir, dep, false]);
    }
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) {
      if (!optionalPeer(dep)) queue.push([dir, dep, false]);
    }
  }
  return new Set([...seen].map(entryOf));
}

const rootDeps = Object.keys(manifest(app).dependencies).map((n) => [n, true]);
const apiEntries = closure(app, rootDeps);
const client = locate(app, '@prisma/client');
if (!client) throw new Error('@prisma/client is missing');
const cliEntries = closure(client, [['prisma', true]]);

/** Where each hoisted link points, read before anything moves. */
function links(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name);
    if (item.isSymbolicLink()) return [full];
    return item.isDirectory() && item.name.startsWith('@') ? links(full) : [];
  });
}
const hoisted = links(modules).map((link) => [
  link,
  path.resolve(path.dirname(link), fs.readlinkSync(link)),
]);

// A rename keeps symlinks as they are, including ones whose target has already moved.
function move(source) {
  const target = path.join(cli, path.relative(app, source));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
  if (!entry.isDirectory() || apiEntries.has(entry.name)) continue;
  const full = path.join(store, entry.name);
  if (cliEntries.has(entry.name)) move(full);
  else fs.rmSync(full, { recursive: true, force: true });
}
for (const [link, target] of hoisted) {
  if (!target.startsWith(store + path.sep)) continue;
  const entry = entryOf(target);
  if (apiEntries.has(entry)) continue;
  if (cliEntries.has(entry)) move(link);
  else fs.rmSync(link);
}

/** Deletes the files under `dir` that `unwanted` matches. */
function prune(dir, unwanted) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (unwanted(full, item)) fs.rmSync(full, { recursive: true, force: true });
    else if (item.isDirectory()) prune(full, unwanted);
  }
}

// Shell shims, source maps, type declarations and readmes are never loaded.
const dead = (full, item) =>
  item.name === '.bin' || /(\.map|\.d\.[cm]?ts|\.md|\.markdown)$/i.test(full);
// The WebAssembly query engines are for edge runtimes. The api uses the native one.
const edgeEngine = (full) =>
  /[\\/](@prisma[\\/]client[\\/]runtime|\.prisma[\\/]client)[\\/](query_(engine|compiler)_)[^\\/]*$/.test(
    full,
  );
// migrate deploy talks to PostgreSQL through the native schema engine. Prisma Studio's
// files and the CLI's WebAssembly query engines are not part of it.
const unusedCli = (full) =>
  /[\\/]node_modules[\\/]prisma[\\/](build[\\/](public|query_(engine|compiler)_[^\\/]*)|prisma-client)$/.test(
    full,
  );

// The HEIC decoder ships four builds. The api loads only the WebAssembly bundle.
const unusedDecoder = (full) =>
  /[\\/]node_modules[\\/]libheif-js[\\/](libheif|libheif-wasm[\\/](libheif\.js|libheif\.wasm|libheif-bundle\.mjs))$/.test(
    full,
  );

prune(
  modules,
  (full, item) => dead(full, item) || edgeEngine(full) || unusedDecoder(full),
);
const cliModules = path.join(cli, 'node_modules');
prune(cliModules, (full, item) => dead(full, item) || unusedCli(full));

// The CLI and the generated client ship the same query engine library. Keep the
// client's copy and point the CLI at it.
function find(dir, pattern) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) return find(full, pattern);
    return item.isFile() && pattern.test(item.name) ? [full] : [];
  });
}
const library = /^libquery_engine-.*\.node$/;
const originals = find(store, library);
for (const copy of find(cliModules, library)) {
  const same = originals.find(
    (file) =>
      path.basename(file) === path.basename(copy) &&
      fs.readFileSync(file).equals(fs.readFileSync(copy)),
  );
  if (!same) continue;
  // The link is read in the image, where both trees sit under the same directory.
  const inImage = path.join(app, path.relative(cli, copy));
  fs.rmSync(copy);
  fs.symlinkSync(path.relative(path.dirname(inImage), same), copy);
}

console.log(
  `api keeps ${apiEntries.size} packages; the Prisma CLI adds ${
    [...cliEntries].filter((e) => !apiEntries.has(e)).length
  }`,
);
