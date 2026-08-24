import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSafeObjectKey, tenantObjectKey, type TenantObjectKind } from '../tenancy/tenant-keys';

@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = config.get<string>('STORAGE_LOCAL_DIR', './uploads');
  }

  async save(
    buffer: Buffer,
    originalName: string,
    scope: { organisationId: string; importJobId: string; kind: TenantObjectKind },
  ): Promise<string> {
    const key = tenantObjectKey({ ...scope, originalName });
    const path = join(this.root, key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, buffer);
    return key;
  }

  async read(key: string, organisationId?: string): Promise<Buffer> {
    if (!isSafeObjectKey(key, organisationId)) {
      throw new NotFoundException('File not found');
    }
    return readFile(join(this.root, key));
  }
}
