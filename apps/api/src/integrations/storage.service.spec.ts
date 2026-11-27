import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService quota', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'harbour-storage-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const make = () => {
    const env: Record<string, string> = {
      STORAGE_LOCAL_DIR: root,
      STORAGE_ORG_QUOTA_MB: '1',
    };
    return new StorageService({
      get: (key: string, fallback?: string) => env[key] ?? fallback,
    } as ConfigService);
  };

  const scope = (organisationId: string, importJobId = 'job-1') => ({
    organisationId,
    importJobId,
    kind: 'photos' as const,
  });
  const kilobytes = (count: number) => Buffer.alloc(count * 1024);

  it('counts every job of one organisation', async () => {
    const storage = make();
    await storage.save(kilobytes(700), 'a.jpg', scope('org-1', 'job-1'));
    await expect(
      storage.save(kilobytes(400), 'b.jpg', scope('org-1', 'job-2')),
    ).rejects.toThrow(PayloadTooLargeException);
    await expect(
      storage.save(kilobytes(300), 'c.jpg', scope('org-1', 'job-2')),
    ).resolves.toContain('org-1/jobs/job-2/photos/');
  });

  it('keeps organisations apart', async () => {
    const storage = make();
    await storage.save(kilobytes(900), 'a.jpg', scope('org-1'));
    await expect(
      storage.save(kilobytes(900), 'a.jpg', scope('org-2')),
    ).resolves.toBeDefined();
  });

  it('holds the limit when uploads arrive together', async () => {
    const storage = make();
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map(() =>
        storage.save(kilobytes(400), 'a.jpg', scope('org-1')),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  });
});
