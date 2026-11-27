import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RouteWorkflow, WorkflowStageDef } from '@vip/shared';
import { api } from '../../lib/api';
import { countryName } from '../job/countries';

export type RouteSummary = RouteWorkflow & {
  activeJobs: number;
  jobsByStatus: Record<string, number>;
};

export const ROUTES_KEY = ['routes'];

export function useRoutes() {
  return useQuery({ queryKey: ROUTES_KEY, queryFn: () => api<RouteSummary[]>('/routes') });
}

/** A change to a route. Every one refreshes the list, which is what the page draws from. */
export function useRouteChange<Input>(request: (input: Input) => Promise<RouteWorkflow>, onDone?: (route: RouteWorkflow) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async (route) => {
      await queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
      onDone?.(route);
    },
  });
}

export const routeApi = {
  create: (body: { name: string; shortLabel: string; originCountry: string; destinationCountry: string; copyFromId?: string }) =>
    api<RouteWorkflow>('/routes', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Pick<RouteWorkflow, 'name' | 'shortLabel' | 'originCountry' | 'destinationCountry' | 'active' | 'isDefault'>>) =>
    api<RouteWorkflow>(`/routes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  saveStage: (routeId: string, stageId: string | null, body: StageInput) =>
    api<RouteWorkflow>(stageId ? `/routes/${routeId}/stages/${stageId}` : `/routes/${routeId}/stages`, {
      method: stageId ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),
  reorder: (routeId: string, stageIds: string[]) =>
    api<RouteWorkflow>(`/routes/${routeId}/stages/order`, { method: 'PUT', body: JSON.stringify({ stageIds }) }),
  removeStage: (routeId: string, stageId: string, moveTo?: string) =>
    api<RouteWorkflow>(`/routes/${routeId}/stages/${stageId}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`, { method: 'DELETE' }),
};

export type StageInput = {
  name: string;
  customerName: string;
  customerVisible: boolean;
  statuses: Array<{ code?: string; label: string }>;
};

export const stageInput = (stage: WorkflowStageDef, patch: Partial<StageInput> = {}): StageInput => ({
  name: stage.name,
  customerName: stage.customerName,
  customerVisible: stage.customerVisible,
  statuses: stage.statuses.map((s) => ({ code: s.code, label: s.label })),
  ...patch,
});

/** Open jobs at any of a stage's statuses. */
export const jobsInStage = (route: RouteSummary, stage: WorkflowStageDef) =>
  stage.statuses.reduce((sum, status) => sum + (route.jobsByStatus[status.code] ?? 0), 0);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const stagesWord = (n: number) => plural(n, 'stage', 'stages');
export const statusesWord = (n: number) => plural(n, 'status', 'statuses');
export const jobsWord = (n: number) => plural(n, 'job', 'jobs');

/** "5 stages · 12 active jobs", as on the route cards. */
export function routeSummary(route: RouteSummary) {
  const n = route.activeJobs;
  const jobs = n ? `${n} active ${n === 1 ? 'job' : 'jobs'}` : route.active ? 'no active jobs' : 'no jobs yet';
  return `${stagesWord(route.stages.length)} · ${jobs}`;
}

/** A route name from its countries, such as "Japan → Cyprus". */
export const routeName = (origin: string, destination: string) => `${countryName(origin)} → ${countryName(destination)}`;
export const routeLabel = (origin: string, destination: string) => `${origin} → ${destination}`;
