/**
 * Checks that a file starts the way its declared type says it should. The type
 * a browser sends is only a claim. This is not a malware scan.
 */
type Check = (bytes: Buffer) => boolean;

const startsWith =
  (...signature: number[]): Check =>
  (bytes) =>
    bytes.subarray(0, signature.length).equals(Buffer.from(signature));

const text = (bytes: Buffer, from: number, to: number) =>
  bytes.toString('latin1', from, to);

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
  'heif',
]);

/** HEIC and HEIF are ISO media files: a `ftyp` box that names the brand. */
const isHeif: Check = (bytes) =>
  text(bytes, 4, 8) === 'ftyp' && HEIF_BRANDS.has(text(bytes, 8, 12));

const SIGNATURES: Record<string, Check> = {
  'image/jpeg': startsWith(0xff, 0xd8, 0xff),
  'image/png': startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/webp': (bytes) =>
    text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP',
  'image/heic': isHeif,
  'image/heif': isHeif,
  // Little-endian and big-endian, classic and BigTIFF.
  'image/tiff': (bytes) =>
    ['II*\0', 'MM\0*', 'II+\0', 'MM\0+'].includes(text(bytes, 0, 4)),
  // Readers accept the header anywhere in the first kilobyte.
  'application/pdf': (bytes) => text(bytes, 0, 1024).includes('%PDF-'),
  'application/msword': startsWith(
    0xd0,
    0xcf,
    0x11,
    0xe0,
    0xa1,
    0xb1,
    0x1a,
    0xe1,
  ),
  // A .docx file is a zip archive.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    startsWith(0x50, 0x4b, 0x03, 0x04),
};

/** False for a type with no known signature, so a new type must be added here. */
export function matchesSignature(mimeType: string, bytes: Buffer): boolean {
  return SIGNATURES[mimeType]?.(bytes) ?? false;
}
