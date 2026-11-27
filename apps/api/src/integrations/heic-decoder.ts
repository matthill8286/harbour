import { Worker } from 'node:worker_threads';

/** A 48 megapixel iPhone photo fits. Decoding needs 4 bytes for every pixel. */
export const MAX_HEIC_PIXELS = 64_000_000;
const TIMEOUT_MS = 60_000;

export type Pixels = { data: Buffer; width: number; height: number };

// The worker is given as source text, so it runs the same from the TypeScript
// sources under Jest and from the compiled build.
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const libheif = require(workerData.library);
  const image = new libheif.HeifDecoder().decode(workerData.bytes)[0];
  if (!image) throw new Error('No picture in the file');
  const width = image.get_width();
  const height = image.get_height();
  if (!(width > 0 && height > 0) || width * height > workerData.maxPixels) {
    throw new Error('The picture is too large');
  }
  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise((resolve, reject) =>
    image.display({ data, width, height }, (shown) =>
      shown ? resolve() : reject(new Error('The picture did not decode')),
    ),
  );
  parentPort.postMessage({ width, height, data: data.buffer }, [data.buffer]);
})().catch((error) => parentPort.postMessage({ error: String(error.message) }));
`;

/**
 * Decodes a HEIC or HEIF photo to RGBA pixels, already turned the right way up.
 * libheif runs as WebAssembly in its own thread: it would otherwise stop the api
 * for seconds, and ending the thread gives its memory back.
 */
export function decodeHeic(bytes: Buffer): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      eval: true,
      workerData: {
        bytes,
        library: require.resolve('libheif-js/wasm-bundle'),
        maxPixels: MAX_HEIC_PIXELS,
      },
    });
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('Decoding took too long'))),
      TIMEOUT_MS,
    );
    worker.once(
      'message',
      (message: {
        error?: string;
        data: ArrayBuffer;
        width: number;
        height: number;
      }) =>
        finish(() =>
          message.error
            ? reject(new Error(message.error))
            : resolve({
                data: Buffer.from(message.data),
                width: message.width,
                height: message.height,
              }),
        ),
    );
    worker.once('error', (error: Error) => finish(() => reject(error)));
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`The decoder stopped (${code})`))),
    );
  });
}
