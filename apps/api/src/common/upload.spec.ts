import { BadRequestException } from '@nestjs/common';
import { requireUpload } from './upload';

describe('requireUpload', () => {
  it('rejects a missing file', () => {
    expect(() => requireUpload(undefined)).toThrow(BadRequestException);
    expect(() => requireUpload(undefined)).toThrow('A file is required');
  });

  it('returns the uploaded file', () => {
    const file = { originalname: 'v5c.pdf', mimetype: 'application/pdf' } as Express.Multer.File;
    expect(requireUpload(file)).toBe(file);
  });
});
