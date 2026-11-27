import { ConfigService } from '@nestjs/config';
import { DashboardService } from './dashboard.service';

const route = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: id === 'uk' ? 'UK → Cyprus' : 'Japan → Cyprus',
  shortLabel: id === 'uk' ? 'GB → CY' : 'JP → CY',
  isDefault: id === 'uk',
  active: true,
  activeJobs: 0,
  stages: [
    { id: `${id}-a`, name: 'First', statuses: [{ code: 'A' }, { code: 'B' }] },
    { id: `${id}-b`, name: 'Second', statuses: [{ code: 'C' }] },
  ],
  ...overrides,
});

function board(routes: unknown[]) {
  const service = new DashboardService(
    {} as never,
    {} as ConfigService,
    {} as never,
    {} as never,
  ) as unknown as {
    byRoute: (
      routes: unknown[],
      counts: Array<{
        routeId: string | null;
        status: string;
        _count: { _all: number };
      }>,
      routeId?: string,
    ) => Array<{
      id: string;
      activeJobs: number;
      completed: number;
      stages: Array<{ id: string; count: number }>;
    }>;
  };
  return {
    byRoute: (
      jobs: Array<[routeId: string | null, status: string, count?: number]>,
      routeId?: string,
    ) =>
      service.byRoute(
        routes,
        jobs.map(([id, status, count = 1]) => ({
          routeId: id,
          status,
          _count: { _all: count },
        })),
        routeId,
      ),
  };
}

describe('Board counts by route and stage', () => {
  it('counts open jobs in each stage of their own route, and completed ones apart', () => {
    const result = board([route('uk'), route('jp')]).byRoute([
      ['uk', 'A', 1],
      ['uk', 'B', 1],
      ['jp', 'C', 4],
      ['jp', 'COMPLETED', 3],
      ['uk', 'CANCELLED', 2],
    ]);
    expect(result.map((r) => [r.id, r.activeJobs, r.completed])).toEqual([
      ['uk', 2, 0],
      ['jp', 4, 3],
    ]);
    expect(result[0].stages.map((s) => s.count)).toEqual([2, 0]);
    expect(result[1].stages.map((s) => s.count)).toEqual([0, 4]);
  });

  it('counts a job without a route on the default route', () => {
    const [uk] = board([route('uk')]).byRoute([[null, 'C']]);
    expect(uk.stages.map((s) => s.count)).toEqual([0, 1]);
  });

  it('leaves out drafts with no jobs, and shows only the chosen route when filtered', () => {
    const service = board([route('uk'), route('jp', { active: false })]);
    expect(service.byRoute([]).map((r) => r.id)).toEqual(['uk']);
    expect(service.byRoute([], 'jp').map((r) => r.id)).toEqual(['jp']);
  });
});
