import {
  Controller,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MAX_UPLOAD_BYTES, photoUpload } from './upload';

@Controller('upload')
class UploadController {
  @Post()
  @UseInterceptors(FileInterceptor('image', photoUpload))
  upload(@UploadedFile() file: Express.Multer.File) {
    return { size: file.buffer.length };
  }
}

/** The same options the routes use, sent through a real request. */
describe('photo upload limits', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UploadController],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const jpeg = (length: number) => {
    const buffer = Buffer.alloc(length);
    buffer.set([0xff, 0xd8, 0xff]);
    return buffer;
  };
  const send = (buffer: Buffer, contentType = 'image/jpeg') =>
    request(app.getHttpServer())
      .post('/upload')
      .attach('image', buffer, { filename: 'plate.jpg', contentType });

  it('accepts a photo', async () => {
    await send(jpeg(100)).expect(201, { size: 100 });
  });

  it('refuses a file over the size limit', async () => {
    await send(jpeg(MAX_UPLOAD_BYTES + 1)).expect(413);
  });

  it('refuses a type that is not a photo', async () => {
    await send(Buffer.from('%PDF-1.7'), 'application/pdf').expect(400);
  });

  it('refuses bytes that do not match the type', async () => {
    const response = await send(Buffer.from('<html></html>')).expect(400);
    expect(response.body).toMatchObject({
      message: 'The file does not match its file type',
    });
  });

  it('refuses a second file', async () => {
    await send(jpeg(10))
      .attach('image', jpeg(10), {
        filename: 'second.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
  });

  it('refuses a large text field', async () => {
    await send(jpeg(10))
      .field('note', 'a'.repeat(20 * 1024))
      .expect(400);
  });

  it('refuses many fields', async () => {
    const pending = send(jpeg(10));
    for (let index = 0; index < 20; index += 1) {
      void pending.field(`field${index}`, 'x');
    }
    await pending.expect(400);
  });
});
