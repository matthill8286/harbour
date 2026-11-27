import { describe, expect, it } from 'vitest';
import { jobCounts } from './job-counts';

const counts = jobCounts(
  [
    { routeId: 'uk', status: 'A', count: 4000 },
    { routeId: null, status: 'A', count: 2 },
    { routeId: 'uk', status: 'COMPLETED', count: 3 },
    { routeId: 'jp', status: 'A', count: 5 },
    { routeId: 'jp', status: 'CANCELLED', count: 1 },
  ],
  'uk',
  (routeId, status) => `${routeId}:${status}`,
);

describe('jobCounts', () => {
  it('counts each route, with jobs that have none on the default one', () => {
    expect(counts.onRoute('uk')).toBe(4005);
    expect(counts.onRoute('jp')).toBe(6);
    expect(counts.onRoute('')).toBe(4011);
  });

  it('counts a stage of one route, and completed jobs apart', () => {
    expect(counts.inStage('uk', 'uk:A')).toBe(4002);
    expect(counts.inStage('uk', 'completed')).toBe(3);
    expect(counts.inStage('', 'jp:A')).toBe(5);
    expect(counts.inStage('jp', 'jp:CANCELLED')).toBe(0);
  });
});
