/**
 * Makes copies of photos that any browser can show and that carry no metadata.
 * sharp writes no EXIF, XMP, IPTC or comments unless asked to, so a copy has no
 * location, camera, owner or capture time. The original is only ever read.
 */
import sharp, { type Sharp } from 'sharp';
import { decodeHeic } from './heic-decoder';

const MAX_PIXELS = 120_000_000;

/** Nothing is kept between pictures, so the api's memory stays low. */
sharp.cache(false);
sharp.concurrency(2);

/**
 * `thumb` is for lists, `display` for looking at a photo, and `clean` is a full
 * size copy of a picture that was uploaded as a document.
 */
export type Variant = 'thumb' | 'display' | 'clean';

type Format = 'jpeg' | 'png' | 'webp' | 'tiff';

const SIZES: Record<Variant, { edge?: number; quality: number }> = {
  thumb: { edge: 640, quality: 78 },
  display: { edge: 2560, quality: 82 },
  clean: { quality: 92 },
};

const CLEAN_FORMATS: Record<string, Format> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'jpeg',
  'image/heif': 'jpeg',
  'image/tiff': 'tiff',
};

const EXTENSIONS: Record<Format, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  tiff: 'tif',
};

export const isPicture = (mimeType: string) => mimeType in CLEAN_FORMATS;

const formatFor = (mimeType: string, variant: Variant): Format =>
  variant === 'clean' ? (CLEAN_FORMATS[mimeType] ?? 'jpeg') : 'jpeg';

/** The type and extension of a copy. */
export function renditionType(mimeType: string, variant: Variant) {
  const format = formatFor(mimeType, variant);
  return { mimeType: `image/${format}`, extension: EXTENSIONS[format] };
}

export class UnreadablePicture extends Error {}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs picture work one at a time, so that many requests at once cannot use up
 * the memory of the server.
 */
export function inPictureQueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function open(bytes: Buffer, mimeType: string): Promise<() => Sharp> {
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    const { data, width, height } = await decodeHeic(bytes);
    return () => sharp(data, { raw: { width, height, channels: 4 } });
  }
  const options = { limitInputPixels: MAX_PIXELS, failOn: 'error' as const };
  const { pages = 1 } = await sharp(bytes, options).metadata();
  // A copy would hold the first page only, and so lose the rest of a scan.
  if (mimeType === 'image/tiff' && pages > 1) {
    throw new UnreadablePicture('A TIFF with several pages cannot be copied');
  }
  // Turns the pixels as the camera's orientation tag says, which the copy drops.
  return () => sharp(bytes, options).autoOrient();
}

/**
 * Copies of one picture, in the order asked for. The picture is decoded once.
 * Call it inside `inPictureQueue`.
 */
export async function render(
  bytes: Buffer,
  mimeType: string,
  variants: Variant[],
): Promise<Buffer[]> {
  try {
    const source = await open(bytes, mimeType);
    const copies: Buffer[] = [];
    for (const variant of variants) {
      const { edge, quality } = SIZES[variant];
      const format = formatFor(mimeType, variant);
      let picture = source();
      if (edge) {
        picture = picture.resize({
          width: edge,
          height: edge,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
      // JPEG has no transparency, so see-through parts become white.
      if (format === 'jpeg') {
        picture = picture.flatten({ background: '#ffffff' });
      }
      copies.push(
        await picture
          .toFormat(
            format,
            format === 'png'
              ? {}
              : format === 'tiff'
                ? { quality, compression: 'lzw' }
                : { quality },
          )
          .toBuffer(),
      );
    }
    return copies;
  } catch (error) {
    if (error instanceof UnreadablePicture) throw error;
    throw new UnreadablePicture((error as Error).message);
  }
}
