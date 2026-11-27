import { isTerminalStatus } from '@vip/shared';

/** How many matching jobs the server found at one status of one route. */
export type JobCount = { routeId: string | null; status: string; count: number };

/**
 * What the Jobs screen's chips show. The server counts every matching job, so
 * the numbers do not depend on how many rows have loaded. A job without a route
 * counts on the default one.
 */
export function jobCounts(counts: JobCount[], defaultRouteId: string | null, stageOfStatus: (routeId: string | null, status: string) => string) {
  const rows = counts.map((row) => ({ ...row, routeId: row.routeId ?? defaultRouteId }));
  const sum = (some: JobCount[]) => some.reduce((total, row) => total + row.count, 0);
  const on = (routeId: string) => (routeId ? rows.filter((row) => row.routeId === routeId) : rows);
  return {
    /** Jobs on a route, or on every route when none is named. */
    onRoute: (routeId: string) => sum(on(routeId)),
    inStage: (routeId: string, stageId: string) =>
      sum(
        on(routeId).filter((row) => {
          if (stageId === 'completed') return row.status === 'COMPLETED';
          return !isTerminalStatus(row.status) && stageOfStatus(row.routeId, row.status) === stageId;
        }),
      ),
  };
}
