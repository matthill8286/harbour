/**
 * The extension each accepted type is stored under. It comes from the checked
 * type, never from the name the browser sent.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
};

export const extensionFor = (mimeType: string) => EXTENSIONS[mimeType] ?? 'bin';
