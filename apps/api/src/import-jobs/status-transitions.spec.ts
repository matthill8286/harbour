import { JOB_STATUSES, STATUS_TRANSITIONS, type JobStatus } from '@vip/shared';

describe('STATUS_TRANSITIONS', () => {
  it('covers every job status exactly once', () => {
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual(
      [...JOB_STATUSES].sort(),
    );
  });

  it('only allows declared JobStatus values', () => {
    const allowed = new Set<string>(JOB_STATUSES);
    for (const [from, next] of Object.entries(STATUS_TRANSITIONS)) {
      expect(allowed.has(from)).toBe(true);
      for (const status of next) {
        expect(allowed.has(status)).toBe(true);
      }
    }
  });

  it('keeps terminal statuses closed', () => {
    expect(STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('moves Cyprus-ready jobs only to completed or cancelled', () => {
    expect(STATUS_TRANSITIONS.READY_FOR_CUSTOMER_COLLECTION).toEqual([
      'COMPLETED',
      'CANCELLED',
    ]);
  });

  it('does not skip the UK-to-Cyprus workflow', () => {
    expect(STATUS_TRANSITIONS.NEW).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(STATUS_TRANSITIONS.NEW).not.toContain('COLLECTED');
    expect(STATUS_TRANSITIONS.IN_TRANSIT_TO_GREECE).toEqual([
      'AT_GREECE',
      'CANCELLED',
    ]);
  });

  it('lets every non-terminal status cancel', () => {
    const open = JOB_STATUSES.filter(
      (status) => status !== 'COMPLETED' && status !== 'CANCELLED',
    );
    for (const status of open) {
      expect(STATUS_TRANSITIONS[status as JobStatus]).toContain('CANCELLED');
    }
  });
});
