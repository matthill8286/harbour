import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { Readable } from 'node:stream';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isSafeObjectKey,
  tenantObjectKey,
  type TenantObjectKind,
} from '../tenancy/tenant-keys';

const MB = 1024 * 1024;
const DEFAULT_ORG_QUOTA_MB = 2048;
/** All workspaces together. */
const DEFAULT_TOTAL_QUOTA_MB = 20 * 1024;
/** Disk space that uploads always leave for everything else on the server. */
const DEFAULT_MIN_FREE_MB = 10 * 1024;

/** A file stored beside an original: its key is the original's plus the suffix. */
export type Companion = { suffix: string; bytes: Buffer };

export type StoredStream = { stream: Readable; size: number };

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;
  private readonly orgQuotaBytes: number;
  private readonly totalQuotaBytes: number;
  private readonly minFreeBytes: number;
  /** The last write in line. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: ConfigService) {
    this.root = config.get<string>('STORAGE_LOCAL_DIR', './uploads');
    const megabytes = (name: string, fallback: number) => {
      const value = Number(config.get<string>(name));
      return (value > 0 ? value : fallback) * MB;
    };
    this.orgQuotaBytes = megabytes(
      'STORAGE_ORG_QUOTA_MB',
      DEFAULT_ORG_QUOTA_MB,
    );
    this.totalQuotaBytes = megabytes(
      'STORAGE_TOTAL_QUOTA_MB',
      DEFAULT_TOTAL_QUOTA_MB,
    );
    this.minFreeBytes = megabytes('STORAGE_MIN_FREE_MB', DEFAULT_MIN_FREE_MB);
  }

  /** Stores an upload and its copies, if all of them fit. Returns its key. */
  async save(
    buffer: Buffer,
    originalName: string,
    scope: {
      organisationId: string;
      importJobId: string;
      kind: TenantObjectKind;
    },
    companions: Companion[] = [],
  ): Promise<string> {
    const key = tenantObjectKey({ ...scope, originalName });
    const files = [{ suffix: '', bytes: buffer }, ...companions];
    const size = files.reduce((total, file) => total + file.bytes.length, 0);
    // One at a time, so uploads sent together cannot all pass the checks.
    await this.inTurn(async () => {
      const used = await bytesUnder(join(this.root, scope.organisationId));
      if (used + size > this.orgQuotaBytes) {
        throw new PayloadTooLargeException(
          'This workspace has used all of its file storage.',
        );
      }
      await this.requireRoom(size);
      try {
        for (const file of files) {
          await this.write(key + file.suffix, file.bytes);
        }
      } catch (error) {
        await this.unlink(files.map((file) => key + file.suffix));
        throw error;
      }
    });
    return key;
  }

  /**
   * Stores a copy of a file that is already here. It is not held to the
   * workspace's quota, so that a full workspace can still show its photos, but
   * it is held to the limits that protect the server. Nothing is kept if the
   * original has been deleted meanwhile.
   */
  async saveCompanion(
    originalKey: string,
    { suffix, bytes }: Companion,
    organisationId: string,
  ): Promise<void> {
    this.pathOf(originalKey, organisationId);
    await this.inTurn(async () => {
      if (!(await this.exists(originalKey, organisationId))) return;
      await this.requireRoom(bytes.length);
      await this.write(originalKey + suffix, bytes);
    });
  }

  async read(key: string, organisationId?: string): Promise<Buffer> {
    return readFile(this.pathOf(key, organisationId)).catch(notFound);
  }

  /** The file as a stream, so a download is not held in memory. */
  async stream(key: string, organisationId: string): Promise<StoredStream> {
    const handle = await open(this.pathOf(key, organisationId)).catch(notFound);
    try {
      const { size } = await handle.stat();
      // The stream closes the file when it ends or is destroyed.
      return { stream: handle.createReadStream(), size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async exists(key: string, organisationId: string): Promise<boolean> {
    return access(this.pathOf(key, organisationId)).then(
      () => true,
      () => false,
    );
  }

  /** The key of every file in one job's folder, with or without a record. */
  async listJobFiles(
    organisationId: string,
    importJobId: string,
  ): Promise<string[]> {
    const folder = `${organisationId}/jobs/${importJobId}`;
    const root = this.pathOf(folder, organisationId);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true, recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        `${folder}/${relative(root, join(entry.parentPath, entry.name))}`
          .split(sep)
          .join('/'),
      );
  }

  /** Deletes a file and its copies. A file that is already gone is not an error. */
  async remove(
    key: string,
    organisationId: string,
    suffixes: string[] = [],
  ): Promise<void> {
    this.pathOf(key, organisationId);
    // In turn, so a copy that is being written cannot outlive its original.
    await this.inTurn(() =>
      this.unlink(['', ...suffixes].map((suffix) => key + suffix)),
    );
  }

  /**
   * Deletes every file a workspace has, by removing its folder. Used only when
   * the whole workspace is deleted at the end of its contract.
   */
  async removeWorkspace(organisationId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+$/.test(organisationId)) {
      throw new Error('Not a workspace id.');
    }
    await this.inTurn(() =>
      rm(join(this.root, organisationId), { recursive: true, force: true }),
    );
  }

  private pathOf(key: string, organisationId?: string): string {
    if (!isSafeObjectKey(key, organisationId)) {
      throw new NotFoundException('File not found');
    }
    return join(this.root, key);
  }

  private async unlink(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map((key) => rm(join(this.root, key), { force: true })),
    );
  }

  /** Under a temporary name first, so a half written file is never served. */
  private async write(key: string, bytes: Buffer): Promise<void> {
    const path = join(this.root, key);
    const partial = `${path}.${randomUUID()}.partial`;
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(partial, bytes);
      await rename(partial, path);
    } finally {
      await rm(partial, { force: true });
    }
  }

  /** The limits on all workspaces together. */
  private async requireRoom(size: number): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const used = await bytesUnder(this.root);
    const disk = await statfs(this.root);
    const free = disk.bavail * disk.bsize;
    if (
      used + size <= this.totalQuotaBytes &&
      free - size >= this.minFreeBytes
    ) {
      return;
    }
    this.logger.warn(
      `File storage is full: ${Math.round(used / MB)} MB of ${this.totalQuotaBytes / MB} MB used, ` +
        `${Math.round(free / MB)} MB free on the disk, ${this.minFreeBytes / MB} MB kept free.`,
    );
    throw new HttpException(
      'File storage is full. Please contact support.',
      HttpStatus.INSUFFICIENT_STORAGE,
    );
  }

  private async inTurn(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    await next;
  }
}

function notFound(error: NodeJS.ErrnoException): never {
  if (error.code === 'ENOENT') throw new NotFoundException('File not found');
  throw error;
}

/**
 * The size of everything in a folder. It counts the disk rather than database
 * rows, so a file left behind by a failed request still counts.
 */
async function bytesUnder(folder: string): Promise<number> {
  const gone = (error: NodeJS.ErrnoException) => {
    // Deleted while it was being counted.
    if (error.code === 'ENOENT') return null;
    throw error;
  };
  const entries = await readdir(folder, { withFileTypes: true }).catch(gone);
  const sizes = await Promise.all(
    (entries ?? []).map(async (entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return bytesUnder(path);
      if (!entry.isFile()) return 0;
      return (await stat(path).catch(gone))?.size ?? 0;
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}
