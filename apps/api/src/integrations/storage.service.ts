import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = config.get<string>('STORAGE_LOCAL_DIR', './uploads');
  }

  async save(buffer: Buffer, originalName: string): Promise<string> {
    const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : '';
    const key = `${new Date().getFullYear()}/${randomUUID()}${ext}`;
    const path = join(this.root, key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, buffer);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(join(this.root, key));
  }
}
