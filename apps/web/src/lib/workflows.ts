import { useQuery } from '@tanstack/react-query';
import { getStatusLabel, isDestinationReached, isTerminalStatus, stageOfStatus, statusLabel, type JobStatus, type RouteWorkflow } from '@vip/shared';
import { api } from './api';
import { useSession } from './session';

export type RouteSummary = RouteWorkflow & {
  activeJobs: number;
  jobsByStatus: Record<string, number>;
};

export const ROUTES_KEY = ['routes'];

export function useRoutes(enabled = true) {
  return useQuery({ queryKey: ROUTES_KEY, queryFn: () => api<RouteSummary[]>('/routes'), enabled, staleTime: 60_000 });
}

/**
 * Every route in the workspace, and the labels and stages of a status on any
 * of them. A job without a route follows the default one. Until the routes
 * load, labels fall back to the UK → Cyprus names every older job uses.
 */
export function useWorkflows() {
  const { isStaff } = useSession();
  const query = useRoutes(isStaff);
  const routes = query.data ?? [];
  const fallback = routes.find((route) => route.isDefault) ?? routes[0];
  const routeOf = (routeId?: string | null): RouteSummary | undefined => routes.find((route) => route.id === routeId) ?? fallback;

  const label = (routeId: string | null | undefined, code: string) => {
    const route = routeOf(routeId);
    const named = route ? statusLabel(route, code) : code;
    return named === code ? getStatusLabel(code as JobStatus) : named;
  };

  const stageOf = (routeId: string | null | undefined, code: string) => {
    const route = routeOf(routeId);
    return route && !isTerminalStatus(code) ? stageOfStatus(route, code) : null;
  };

  return { routes, routeOf, label, stageOf, isLoading: query.isLoading };
}

/** The stages of a route as progress steps, and which one a status is in. */
export function routeProgress(route: Pick<RouteWorkflow, 'stages'> | undefined, code: string) {
  const steps = (route?.stages ?? []).map((stage) => ({ id: stage.id, label: stage.name }));
  // A completed job sits on the last step, as the fixed strip did.
  if (code === 'COMPLETED') return { steps, current: steps.at(-1)?.id ?? '' };
  const stage = route ? stageOfStatus(route, code) : null;
  return { steps, current: stage?.id ?? '' };
}

/**
 * Whether a job has reached its destination: completed, or in its route's last
 * stage. Without a route, the UK → Cyprus rule applies.
 */
export function hasArrived(route: Pick<RouteWorkflow, 'stages'> | undefined, code: string) {
  if (!route) return isDestinationReached(code as JobStatus);
  if (code === 'COMPLETED') return true;
  const last = route.stages.at(-1);
  return Boolean(last && stageOfStatus(route, code)?.id === last.id);
}
