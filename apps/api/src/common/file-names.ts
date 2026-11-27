/** File names as they are stored, and as they are sent back in a download. */

const MAX_NAME_LENGTH = 200;

/**
 * The name to store for an upload. Browsers send a quote as %22, so it is turned
 * back. Folders, control characters and characters that reorder text are removed.
 * Greek and every other script stay as they are.
 */
export function cleanFileName(raw: string, fallback = 'file'): string {
  const base = raw.replace(/%22/g, '"').split(/[/\\]/).pop() ?? '';
  const clean = base
    .normalize('NFC')
    // Control characters, direction overrides and halves of a surrogate pair.
    .replace(/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/gu, '')
    .trim();
  if (!clean || /^\.+$/.test(clean)) return fallback;
  return shorten(clean);
}

/** Cuts a long name by whole characters and keeps its extension. */
function shorten(name: string): string {
  const characters = Array.from(name);
  if (characters.length <= MAX_NAME_LENGTH) return name;
  const extension = Array.from(/\.[^.]{1,10}$/.exec(name)?.[0] ?? '');
  return [
    ...characters.slice(0, MAX_NAME_LENGTH - extension.length),
    ...extension,
  ].join('');
}

/** The same name with another extension, for a copy in another format. */
export function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]{1,10}$/, '')}.${extension}`;
}

/**
 * A Content-Disposition header that no file name can break. `filename` is a plain
 * ASCII stand-in, and `filename*` carries the real name (RFC 6266).
 */
export function contentDisposition(
  type: 'inline' | 'attachment',
  name: string,
): string {
  const wellFormed = name.replace(/\p{Cs}/gu, '_');
  const ascii = wellFormed.replace(/[^\x20-\x7e]|["\\%]/gu, '_');
  const encoded = encodeURIComponent(wellFormed).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
