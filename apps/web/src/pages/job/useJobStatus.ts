import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getStatusLabel, isTerminalStatus, nextStatus, statusLabel, STATUS_TRANSITIONS, type JobStatus } from '@vip/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { routeProgress } from '../../lib/workflows';
import type { JobDetail } from './types';

/**
 * Where a job can go next on its route, the call that moves it there, and how
 * its statuses read. A job moves one status forward or is cancelled; a closed
 * job does neither.
 */
export function useJobStatus(job: JobDetail) {
  const { canWrite } = useSession();
  const queryClient = useQueryClient();
  const closed = isTerminalStatus(job.status);
  const route = job.route;
  const move = useMutation({
    mutationFn: (status: string) => api(`/import-jobs/${job.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job', job.id] }),
  });
  // Before the API sent routes, every job was on the UK → Cyprus statuses.
  const next = route ? nextStatus(route, job.status) : ((STATUS_TRANSITIONS[job.status as JobStatus] ?? []).find((s) => s !== 'CANCELLED') ?? null);
  const label = (code: string) => {
    const named = route ? statusLabel(route, code) : code;
    return named === code ? getStatusLabel(code as JobStatus) : named;
  };
  return {
    closed,
    editable: canWrite && !closed,
    next,
    canCancel: !closed,
    label,
    progress: routeProgress(route, job.status),
    move,
  };
}
