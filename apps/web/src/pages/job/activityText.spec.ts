import { describe, expect, it } from 'vitest';
import { describeActivity, type ActivityItem } from './activityText';

const item = (action: string, metadata: ActivityItem['metadata']): ActivityItem => ({
  id: '1',
  action,
  createdAt: '2026-11-24T09:12:00Z',
  actor: { name: 'Chris Owner' },
  metadata,
});

describe('describeActivity', () => {
  it('reads a status change as from and to', () => {
    expect(describeActivity(item('JOB_STATUS_CHANGED', { from: 'REGISTERED', to: 'IN_TRANSIT_TO_GREECE' }), 'EUR')).toEqual({
      verb: 'changed status',
      detail: 'Registered → In transit to Greece',
    });
  });

  it('says who can see an uploaded document', () => {
    expect(describeActivity(item('DOCUMENT_UPLOADED', { name: 'Bulgarian registration.pdf', customerVisible: true }), 'EUR').detail).toBe(
      'Bulgarian registration.pdf · visible to customer',
    );
  });

  it('shows what a money line was before an edit, in the workspace currency', () => {
    const edit = item('MONEY_LINE_UPDATED', {
      kind: 'charge',
      category: 'TRANSPORT',
      description: 'Transport service',
      amount: 1950,
      before: { amount: 1800 },
    });
    const { verb, detail } = describeActivity(edit, 'EUR');
    expect(verb).toBe('edited a charge');
    expect(detail).toContain('Transport service');
    expect(detail).toMatch(/1,950\.00.*\(was .*1,800\.00\)/);
  });

  it('names a money line by its category when it has no description', () => {
    expect(describeActivity(item('MONEY_LINE_ADDED', { kind: 'cost', category: 'TRANSPORT', description: '', amount: 300 }), 'EUR').detail).toMatch(
      /^Transport · .*300\.00$/,
    );
  });

  it('falls back to the action in words for anything it does not know', () => {
    expect(describeActivity(item('SOMETHING_NEW', null), 'EUR')).toEqual({ verb: 'something new', detail: '' });
  });
});
