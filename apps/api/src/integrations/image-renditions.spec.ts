import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { render, UnreadablePicture } from './image-renditions';

/** 96 by 64, left half red and right half blue, with GPS, camera and owner. */
const heic = readFileSync(
  join(__dirname, '../../test/fixtures/gps-photo.heic'),
);
const SECRETS = ['FixtureCam', 'Fixture Owner'];

const raw = (width = 3000, height = 2000) =>
  sharp({
    create: { width, height, channels: 3, background: '#c81e1e' },
  });

const jpegWithGps = () =>
  raw()
    .jpeg()
    .withExif({
      IFD0: { Make: SECRETS[0], Artist: SECRETS[1] },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 10/1 0/1' },
    })
    .toBuffer();

async function expectNoMetadata(bytes: Buffer) {
  const found = await sharp(bytes).metadata();
  expect(found.exif).toBeUndefined();
  expect(found.xmp).toBeUndefined();
  expect(found.iptc).toBeUndefined();
  for (const secret of SECRETS) {
    expect(bytes.includes(secret)).toBe(false);
  }
}

describe('photo copies', () => {
  it('has fixtures that really carry metadata', async () => {
    expect((await sharp(await jpegWithGps()).metadata()).exif).toBeDefined();
    for (const secret of SECRETS) {
      expect(heic.includes(secret)).toBe(true);
    }
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/tiff'] as const)(
    'strips metadata from every copy of a %s',
    async (mimeType) => {
      const format = mimeType.split('/')[1] as 'jpeg';
      const original = await sharp(await jpegWithGps())
        .keepMetadata()
        .toFormat(format)
        .toBuffer();
      const copies = await render(original, mimeType, [
        'thumb',
        'display',
        'clean',
      ]);
      for (const copy of copies) await expectNoMetadata(copy);
      const sizes = await Promise.all(
        copies.map(async (copy) => (await sharp(copy).metadata()).width),
      );
      expect(sizes).toEqual([640, 2560, 3000]);
      expect((await sharp(copies[2]).metadata()).format).toBe(format);
    },
  );

  it('turns a HEIC photo into a JPEG without metadata', async () => {
    const [copy] = await render(heic, 'image/heic', ['display']);
    await expectNoMetadata(copy);
    const { data, info } = await sharp(copy)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([96, 64]);
    expect(data[0]).toBeGreaterThan(180);
    expect(data[(info.width - 1) * info.channels + 2]).toBeGreaterThan(180);
  });

  it('turns the picture as the camera said before dropping that tag', async () => {
    const sideways = await raw(300, 200)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const [copy] = await render(sideways, 'image/jpeg', ['display']);
    const { width, height } = await sharp(copy).metadata();
    expect([width, height]).toEqual([200, 300]);
  });

  it('never makes a small picture larger', async () => {
    const [copy] = await render(
      await raw(100, 80).png().toBuffer(),
      'image/png',
      ['thumb'],
    );
    expect((await sharp(copy).metadata()).width).toBe(100);
  });

  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])],
    ['image/heic', Buffer.from('\0\0\0\x18ftypheic\0\0\0\0')],
  ])('refuses a broken %s', async (mimeType, bytes) => {
    await expect(render(bytes, mimeType, ['thumb'])).rejects.toThrow(
      UnreadablePicture,
    );
  });

  it('will not make a copy that drops pages of a TIFF', async () => {
    const page = await raw(20, 20).raw().toBuffer();
    const pages = await sharp(Buffer.concat([page, page]), {
      raw: { width: 20, height: 40, channels: 3, pageHeight: 20 },
    })
      .tiff()
      .toBuffer();
    expect((await sharp(pages).metadata()).pages).toBe(2);
    await expect(render(pages, 'image/tiff', ['clean'])).rejects.toThrow(
      UnreadablePicture,
    );
  });
});
