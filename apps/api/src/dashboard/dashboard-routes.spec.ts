import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

const user = { organisationId: 'org-1' } as AuthUser;

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
  const workflows = { list: jest.fn().mockResolvedValue(routes) };
  const service = new DashboardService(
    {} as never,
    {} as ConfigService,
    {} as never,
    workflows as never,
  );
  return service as unknown as {
    byRoute: (
      user: AuthUser,
      jobs: Array<{ status: string; routeId: string | null }>,
      routeId?: string,
    ) => Promise<
      Array<{
        id: string;
        activeJobs: number;
        completed: number;
        stages: Array<{ id: string; count: number }>;
      }>
    >;
  };
}

describe('Board counts by route and stage', () => {
  it('counts open jobs in each stage of their own route, and completed ones apart', async () => {
    const service = board([route('uk'), route('jp')]);
    const result = await service.byRoute(user, [
      { status: 'A', routeId: 'uk' },
      { status: 'B', routeId: 'uk' },
      { status: 'C', routeId: 'jp' },
      { status: 'COMPLETED', routeId: 'jp' },
      { status: 'CANCELLED', routeId: 'uk' },
    ]);
    expect(result.map((r) => [r.id, r.activeJobs, r.completed])).toEqual([
      ['uk', 2, 0],
      ['jp', 1, 1],
    ]);
    expect(result[0].stages.map((s) => s.count)).toEqual([2, 0]);
    expect(result[1].stages.map((s) => s.count)).toEqual([0, 1]);
  });

  it('counts a job without a route on the default route', async () => {
    const [uk] = await board([route('uk')]).byRoute(user, [
      { status: 'C', routeId: null },
    ]);
    expect(uk.stages.map((s) => s.count)).toEqual([0, 1]);
  });

  it('leaves out drafts with no jobs, and shows only the chosen route when filtered', async () => {
    const service = board([route('uk'), route('jp', { active: false })]);
    expect((await service.byRoute(user, [])).map((r) => r.id)).toEqual(['uk']);
    expect((await service.byRoute(user, [], 'jp')).map((r) => r.id)).toEqual([
      'jp',
    ]);
  });
});
