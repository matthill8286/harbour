/**
 * A second record of every erasure, kept outside the database, so that restoring
 * an older database dump cannot bring an erased customer back unnoticed. It is
 * one JSON object a line, only ever added to. It holds ids and storage keys,
 * which contain no personal data.
 */
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type RemovedFile = { key: string; mimeType: string };

export type ErasureEntry = {
  type: 'erasure';
  erasureId: string;
  organisationId: string;
  customerId: string;
  performedById: string;
  at: string;
  files: RemovedFile[];
};

export type ReviewRemovalEntry = {
  type: 'review-removal';
  erasureId: string;
  organisationId: string;
  customerId: string;
  performedById: string;
  at: string;
  kind: ReviewKind;
  recordId: string;
  files: RemovedFile[];
};

export type ReviewKind = 'DOCUMENT' | 'PHOTO' | 'COST' | 'CHARGE';
export type JournalEntry = ErasureEntry | ReviewRemovalEntry;

@Injectable()
export class ErasureJournal {
  readonly path: string;

  constructor(config: ConfigService) {
    // On the uploads volume by default: it is backed up, and a database restore
    // leaves it alone. A folder that starts with a dot is no workspace's.
    const folder =
      config.get<string>('ERASURE_JOURNAL_DIR')?.trim() ||
      join(
        config.get<string>('STORAGE_LOCAL_DIR', './uploads'),
        '.erasure-journal',
      );
    this.path = join(folder, 'journal.jsonl');
  }

  /** Written to the disk before it returns. */
  async append(entry: JournalEntry): Promise<void> {
    await mkdir(join(this.path, '..'), { recursive: true });
    const handle = await open(this.path, 'a', 0o600);
    try {
      // The leading newline keeps a line cut short earlier away from this one.
      await handle.write(`\n${JSON.stringify(entry)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async read(path = this.path): Promise<JournalEntry[]> {
    const text = await readFile(path, 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      },
    );
    return text
      .split('\n')
      .filter((line) => line.trim())
      .map((line, index) => {
        try {
          return JSON.parse(line) as JournalEntry;
        } catch {
          // Never skipped quietly: it may be an erasure that must be repeated.
          throw new Error(
            `Entry ${index + 1} of ${path} cannot be read. Look at it before going on.`,
          );
        }
      });
  }
}
