// Fails on any high or critical advisory in production dependencies that
// .github/audit-exceptions.json does not accept with a reason and a review date.
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const { exceptions } = require(join(__dirname, '..', 'audit-exceptions.json'));
const run = spawnSync('pnpm', ['audit', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
// pnpm exits 1 when it finds anything, so the report decides, not the exit code.
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  report = undefined;
}
if (!report?.advisories || !report.metadata) {
  console.error('pnpm audit returned no report.');
  console.error(run.stdout || run.stderr || run.error);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const failures = [];
const used = new Set();
for (const advisory of Object.values(report.advisories)) {
  if (!['high', 'critical'].includes(advisory.severity)) continue;
  const id = advisory.github_advisory_id;
  const name = `${advisory.severity} ${advisory.module_name} ${id}`;
  const accepted = exceptions.find(
    (e) => e.id === id && e.package === advisory.module_name,
  );
  if (!accepted?.reason || !accepted.reviewBy) {
    failures.push(`${name}: ${advisory.title} (${advisory.url})`);
    continue;
  }
  used.add(accepted);
  if (accepted.reviewBy < today) {
    failures.push(`${name}: its exception ran out on ${accepted.reviewBy}`);
  } else {
    console.log(`Accepted until ${accepted.reviewBy}: ${name}`);
    console.log(`  ${accepted.reason}`);
  }
}
for (const e of exceptions.filter((e) => !used.has(e))) {
  console.log(
    `::warning::The audit no longer reports ${e.package} ${e.id}. Remove its exception.`,
  );
}
if (failures.length) {
  console.error('\nNot accepted:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  'No unaccepted high or critical advisory in production dependencies.',
);
