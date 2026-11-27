import { useMutation, useQueryClient } from '@tanstack/react-query';
import { STATUS_TRANSITIONS, type JobStatus } from '@vip/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { JobDetail } from './types';

/**
 * Where a job can go next, and the call that moves it there. Every status has
 * one step forward and Cancel; a closed job has neither.
 */
export function useJobStatus(job: JobDetail) {
  const { canWrite } = useSession();
  const queryClient = useQueryClient();
  const steps = STATUS_TRANSITIONS[job.status] ?? [];
  const closed = job.status === 'COMPLETED' || job.status === 'CANCELLED';
  const move = useMutation({
    mutationFn: (status: JobStatus) => api(`/import-jobs/${job.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job', job.id] }),
  });
  return {
    closed,
    editable: canWrite && !closed,
    next: steps.find((status) => status !== 'CANCELLED') ?? null,
    canCancel: steps.includes('CANCELLED'),
    move,
  };
}
