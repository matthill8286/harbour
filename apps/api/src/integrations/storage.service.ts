import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isSafeObjectKey,
  tenantObjectKey,
  type TenantObjectKind,
} from '../tenancy/tenant-keys';

const DEFAULT_ORG_QUOTA_MB = 2048;

@Injectable()
export class StorageService {
  private readonly root: string;
  private readonly quotaBytes: number;
  /** The last save in line for each organisation. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(config: ConfigService) {
    this.root = config.get<string>('STORAGE_LOCAL_DIR', './uploads');
    const quotaMb = Number(config.get<string>('STORAGE_ORG_QUOTA_MB'));
    this.quotaBytes =
      (quotaMb > 0 ? quotaMb : DEFAULT_ORG_QUOTA_MB) * 1024 * 1024;
  }

  async save(
    buffer: Buffer,
    originalName: string,
    scope: {
      organisationId: string;
      importJobId: string;
      kind: TenantObjectKind;
    },
  ): Promise<string> {
    const key = tenantObjectKey({ ...scope, originalName });
    const path = join(this.root, key);
    // One at a time, so uploads sent together cannot all pass the quota check.
    await this.inTurn(scope.organisationId, async () => {
      const used = await bytesUnder(join(this.root, scope.organisationId));
      if (used + buffer.length > this.quotaBytes) {
        throw new PayloadTooLargeException(
          'This workspace has used all of its file storage.',
        );
      }
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, buffer);
    });
    return key;
  }

  async read(key: string, organisationId?: string): Promise<Buffer> {
    if (!isSafeObjectKey(key, organisationId)) {
      throw new NotFoundException('File not found');
    }
    return readFile(join(this.root, key));
  }

  private async inTurn(
    organisationId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const previous = this.queues.get(organisationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(organisationId, next);
    try {
      await next;
    } finally {
      if (this.queues.get(organisationId) === next) {
        this.queues.delete(organisationId);
      }
    }
  }
}

/**
 * The size of everything in a folder. It counts the disk rather than database
 * rows, so a file left behind by a failed request still counts.
 */
async function bytesUnder(folder: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return bytesUnder(path);
      return entry.isFile() ? (await stat(path)).size : 0;
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}
