import type { JobDetail } from './types';

/** The moment a job reached its current status, from its history: when it was completed or cancelled. */
export function closedAt(job: JobDetail) {
  return [...job.statusHistory].reverse().find((entry) => entry.toStatus === job.status) ?? null;
}
