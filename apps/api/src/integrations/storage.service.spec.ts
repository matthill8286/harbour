import { mkdtemp, readdir, rm } from 'node:fs/promises';
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

  const make = (settings: Record<string, string> = {}) => {
    const env: Record<string, string> = {
      STORAGE_LOCAL_DIR: root,
      STORAGE_ORG_QUOTA_MB: '1',
      // So the tests do not depend on how full this machine's disk is.
      STORAGE_MIN_FREE_MB: '1',
      ...settings,
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

  it('limits all organisations together, even when uploads arrive together', async () => {
    const storage = make({ STORAGE_TOTAL_QUOTA_MB: '1' });
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) =>
        storage.save(kilobytes(400), 'a.jpg', scope(`org-${n}`)),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    await expect(
      storage.save(kilobytes(400), 'a.jpg', scope('org-9')),
    ).rejects.toMatchObject({ status: 507 });
  });

  it('keeps disk space free for everything else on the server', async () => {
    const storage = make({ STORAGE_MIN_FREE_MB: String(1024 * 1024 * 1024) });
    await expect(
      storage.save(kilobytes(1), 'a.jpg', scope('org-1')),
    ).rejects.toThrow('File storage is full');
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('counts copies towards the quota and saves all or nothing', async () => {
    const storage = make();
    await expect(
      storage.save(kilobytes(600), 'a.jpg', scope('org-1'), [
        { suffix: '.copy.jpg', bytes: kilobytes(600) },
      ]),
    ).rejects.toThrow(PayloadTooLargeException);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('removes a file with its copies, and keeps no copy afterwards', async () => {
    const storage = make();
    const copy = { suffix: '.copy.jpg', bytes: kilobytes(1) };
    const key = await storage.save(kilobytes(1), 'a.jpg', scope('org-1'), [
      copy,
    ]);
    await storage.remove(key, 'org-1', [copy.suffix, '.never-made.jpg']);
    await expect(storage.exists(key, 'org-1')).resolves.toBe(false);
    await expect(storage.exists(key + copy.suffix, 'org-1')).resolves.toBe(
      false,
    );
    await storage.saveCompanion(key, copy, 'org-1');
    await expect(storage.exists(key + copy.suffix, 'org-1')).resolves.toBe(
      false,
    );
  });

  it('will not open or delete another organisation file', async () => {
    const storage = make();
    const key = await storage.save(kilobytes(1), 'a.jpg', scope('org-1'));
    await expect(storage.stream(key, 'org-2')).rejects.toThrow(
      'File not found',
    );
    await expect(storage.remove(key, 'org-2')).rejects.toThrow(
      'File not found',
    );
    await expect(storage.exists(key, 'org-1')).resolves.toBe(true);
  });

  it('answers 404 for a file that is not on disk', async () => {
    await expect(
      make().stream('org-1/jobs/j/photos/none.jpg', 'org-1'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
