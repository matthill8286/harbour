import { AlertPolish, POLISH_TTL_MS } from './alert-polish';
import type { EnrichedOpsAlert } from './ops-alert-triage';

const alert = (id: string): EnrichedOpsAlert => ({
  kind: 'STALE_TRACKER',
  importJobId: id,
  reference: id,
  title: 'Tracker quiet',
  detail: 'Quiet',
  trackerSerial: 'SN1',
  aiSummary: 'heuristic',
});
const answer = (id: string, aiSummary: string) => ({
  summaries: [{ kind: 'STALE_TRACKER', importJobId: id, aiSummary }],
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('AlertPolish', () => {
  it('returns at once even when the model never answers, and asks once', async () => {
    const polish = new AlertPolish();
    const ask = jest.fn(() => new Promise<unknown>(() => undefined));
    expect(polish.apply('org-a', [alert('j1')], ask)[0].aiSummary).toBe(
      'heuristic',
    );
    polish.apply('org-a', [alert('j1')], ask);
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('shows the answer on a later load, only to the same workspace', async () => {
    const polish = new AlertPolish();
    polish.apply('org-a', [alert('j1')], () =>
      Promise.resolve(answer('j1', 'polished')),
    );
    await settle();
    const ask = jest.fn(() => Promise.resolve({}));
    expect(polish.apply('org-a', [alert('j1')], ask)[0].aiSummary).toBe(
      'polished',
    );
    expect(ask).not.toHaveBeenCalled();
    expect(polish.apply('org-b', [alert('j1')], ask)[0].aiSummary).toBe(
      'heuristic',
    );
  });

  it('reports a failure and does not ask again until the period has passed', async () => {
    let time = 0;
    const onError = jest.fn();
    const polish = new AlertPolish(onError, () => time);
    const ask = jest.fn(() => Promise.reject(new Error('down')));
    polish.apply('org-a', [alert('j1')], ask);
    await settle();
    polish.apply('org-a', [alert('j1')], ask);
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    time = POLISH_TTL_MS;
    polish.apply('org-a', [alert('j1')], ask);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
