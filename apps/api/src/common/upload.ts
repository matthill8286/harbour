import { BadRequestException } from '@nestjs/common';
import type { Options } from 'multer';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const DOCUMENT_TYPES = new Set([
  ...PHOTO_TYPES,
  'application/pdf',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function filter(allowed: Set<string>): NonNullable<Options['fileFilter']> {
  return (_req, file, callback) => {
    if (!allowed.has(file.mimetype)) {
      callback(new BadRequestException('That file type is not allowed'));
      return;
    }
    callback(null, true);
  };
}

export const photoUpload: Options = {
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: filter(PHOTO_TYPES),
};

export const documentUpload: Options = {
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: filter(DOCUMENT_TYPES),
};

export function requireUpload(file?: Express.Multer.File) {
  if (!file) {
    throw new BadRequestException('A file is required');
  }
  return file;
}
