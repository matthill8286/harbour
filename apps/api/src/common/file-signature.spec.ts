import { matchesSignature } from './file-signature';

const bytes = (value: string) => Buffer.from(value, 'latin1');

describe('matchesSignature', () => {
  it.each([
    ['image/jpeg', '\xff\xd8\xff\xe0'],
    ['image/png', '\x89PNG\r\n\x1a\n'],
    ['image/webp', 'RIFF\0\0\0\0WEBPVP8 '],
    ['image/heic', '\0\0\0\x18ftypheic'],
    ['image/heif', '\0\0\0\x18ftypmif1'],
    ['image/tiff', 'II*\0'],
    ['image/tiff', 'MM\0*'],
    ['application/pdf', '%PDF-1.7'],
    ['application/msword', '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'PK\x03\x04',
    ],
  ])('accepts %s', (type, head) => {
    expect(matchesSignature(type, bytes(head))).toBe(true);
  });

  it.each([
    ['image/jpeg', '<html><script>'],
    ['image/png', '\xff\xd8\xff'],
    ['image/webp', 'RIFF\0\0\0\0WAVE'],
    ['image/heic', '\0\0\0\x18ftypisom'],
    ['application/pdf', 'MZ\x90\0'],
    ['image/jpeg', ''],
    ['text/html', '<html>'],
  ])('rejects %s with the wrong bytes', (type, head) => {
    expect(matchesSignature(type, bytes(head))).toBe(false);
  });
});
