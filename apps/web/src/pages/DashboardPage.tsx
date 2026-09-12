import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { JOB_STAGE_LABELS, type JobStatus } from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { StatusBadge } from '../components/StatusBadge';
import { Card, EmptyState, LoadingScreen, PageHeader, StaffPage, primaryBtn } from '../components/ui';

type Dashboard = {
  activeJobs: number;
  byStage: { stage: string; label: string; count: number }[];
  overdueTasks: {
    id: string;
    title: string;
    dueDate: string | null;
    importJob: { id: string; reference: string };
  }[];
  upcomingDeliveries: {
    id: string;
    reference: string;
    status: JobStatus;
    expectedDeliveryDate: string;
    customer: { firstName: string; lastName: string };
    vehicle: { make: string | null; model: string | null };
  }[];
};

export function DashboardPage() {
  const { canWrite, workspace } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
  });

  if (isLoading || !data) return <LoadingScreen label="Loading workspace…" />;

  return (
    <StaffPage>
      <PageHeader
        eyebrow={workspace}
        title="Board"
        description="What needs attention in this workspace today."
        actions={
          canWrite ? (
            <Link to="/jobs/new" className={primaryBtn}>
              New job
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="rounded-2xl bg-ink p-5 text-paper">
          <p className="text-sm text-mist">Active import jobs</p>
          <p className="display text-5xl">{data.activeJobs}</p>
        </div>
        <Link to="/jobs" className="text-sm font-semibold text-harbour sm:pb-2">
          Browse all jobs →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {data.byStage
          .filter((item) => item.stage !== 'cancelled')
          .map((item) => (
            <Link
              key={item.stage}
              to={`/jobs?stage=${encodeURIComponent(item.stage)}`}
              className="rounded-2xl bg-paper p-3 transition hover:ring-2 hover:ring-harbour/30"
            >
              <p className="text-[11px] uppercase tracking-widest text-ink/50">
                {JOB_STAGE_LABELS[item.stage as keyof typeof JOB_STAGE_LABELS] ?? item.label}
              </p>
              <p className="display text-2xl">{item.count}</p>
            </Link>
          ))}
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Needs attention</h2>
          {data.overdueTasks.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">No overdue tasks.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {data.overdueTasks.map((task) => (
                <li key={task.id}>
                  <Link to={`/jobs/${task.importJob.id}?tab=overview`} className="font-semibold text-harbour">
                    {task.importJob.reference}
                  </Link>
                  <p className="text-ink/70">{task.title}</p>
                  {task.dueDate ? <p className="text-xs text-ink/45">Due {formatDate(task.dueDate)}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">Arriving soon</h2>
          {data.upcomingDeliveries.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">Nothing in the next two weeks.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {data.upcomingDeliveries.map((job) => (
                <li key={job.id} className="flex items-start justify-between gap-2">
                  <div>
                    <Link to={`/jobs/${job.id}`} className="font-semibold text-harbour">
                      {job.reference}
                    </Link>
                    <p className="text-ink/60">
                      {job.vehicle.make} {job.vehicle.model} · {formatDate(job.expectedDeliveryDate)}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {data.activeJobs === 0 ? (
        <EmptyState
          title="No active import jobs"
          description={
            canWrite
              ? 'Create a job to start an import from collection to delivery.'
              : 'No active imports in this workspace yet.'
          }
          action={
            canWrite ? (
              <Link to="/jobs/new" className={primaryBtn}>
                New job
              </Link>
            ) : undefined
          }
        />
      ) : null}
    </StaffPage>
  );
}
