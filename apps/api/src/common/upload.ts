import { BadRequestException } from '@nestjs/common';
import { memoryStorage, type Options, type StorageEngine } from 'multer';
import { matchesSignature } from './file-signature';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const DOCUMENT_TYPES = new Set([
  ...PHOTO_TYPES,
  'application/pdf',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Types some browsers send for a file whose format they do not know. */
const UNNAMED_TYPES = new Set(['', 'application/octet-stream']);

function filter(allowed: Set<string>): NonNullable<Options['fileFilter']> {
  return (_req, file, callback) => {
    // Many browsers outside Apple's do not know HEIC. The first bytes are
    // still checked against the type.
    const heic = /\.(heic|heif)$/i.exec(file.originalname)?.[1];
    if (heic && UNNAMED_TYPES.has(file.mimetype)) {
      file.mimetype = `image/${heic.toLowerCase()}`;
    }
    if (!allowed.has(file.mimetype)) {
      callback(new BadRequestException('That file type is not allowed'));
      return;
    }
    callback(null, true);
  };
}

/**
 * Keeps the upload in memory, as multer does by default, and refuses a file
 * whose first bytes do not match its declared type.
 */
function checkedMemoryStorage(): StorageEngine {
  const memory = memoryStorage();
  return {
    _handleFile(req, file, callback) {
      memory._handleFile(req, file, (error, info) => {
        if (error) {
          callback(error);
        } else if (
          !matchesSignature(file.mimetype, info?.buffer ?? Buffer.alloc(0))
        ) {
          callback(
            new BadRequestException('The file does not match its file type'),
          );
        } else {
          callback(null, info);
        }
      });
    },
    _removeFile(req, file, callback) {
      memory._removeFile(req, file, callback);
    },
  };
}

function uploadOptions(
  allowed: Set<string>,
): Options & { defParamCharset: string } {
  return {
    // Browsers send file names as UTF-8. multer reads them as Latin-1 unless told.
    defParamCharset: 'utf8',
    // One file and a few short text fields. Without these limits, many parts
    // in one request are all held in memory.
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 10,
      fieldSize: 16 * 1024,
      parts: 11,
    },
    fileFilter: filter(allowed),
    storage: checkedMemoryStorage(),
  };
}

export const photoUpload: Options = uploadOptions(PHOTO_TYPES);

export const documentUpload: Options = uploadOptions(DOCUMENT_TYPES);

export function requireUpload(file?: Express.Multer.File) {
  if (!file) {
    throw new BadRequestException('A file is required');
  }
  return file;
}
