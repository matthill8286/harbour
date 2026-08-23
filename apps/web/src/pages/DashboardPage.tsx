import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { JOB_STAGE_LABELS, type JobStatus } from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { Card, EmptyState, LoadingScreen, PageHeader } from '../components/ui';

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
  offlineTrackers: {
    id: string;
    serialNumber: string;
    assignments: { importJob: { id: string; reference: string } }[];
  }[];
};

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
  });

  if (isLoading || !data) return <LoadingScreen label="Loading the desk…" />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Desk board"
        description="Active jobs, overdue work, and vehicles due in the next two weeks."
        actions={
          <Link to="/jobs/new" className="rounded-full bg-harbour px-4 py-2 text-sm font-semibold text-paper">
            New job
          </Link>
        }
      />
      <div className="rounded-3xl bg-ink p-6 text-paper">
        <p className="text-sm text-mist">Active import jobs</p>
        <p className="display text-6xl">{data.activeJobs}</p>
        <Link to="/tracking" className="mt-3 inline-block text-sm text-mist underline-offset-4 hover:underline">
          Open live map
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {data.byStage
          .filter((item) => item.stage !== 'cancelled')
          .map((item) => (
            <Card key={item.stage}>
              <p className="text-xs uppercase tracking-widest text-ink/50">
                {JOB_STAGE_LABELS[item.stage as keyof typeof JOB_STAGE_LABELS] ?? item.label}
              </p>
              <p className="display text-3xl">{item.count}</p>
            </Card>
          ))}
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="display text-2xl">Needs attention</h2>
          {data.overdueTasks.length === 0 ? (
            <p className="mt-3 text-sm text-ink/50">No overdue tasks.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {data.overdueTasks.map((task) => (
                <li key={task.id}>
                  <Link to={`/jobs/${task.importJob.id}`} className="font-semibold text-harbour">
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
          <h2 className="display text-2xl">Arriving soon</h2>
          {data.upcomingDeliveries.length === 0 ? (
            <p className="mt-3 text-sm text-ink/50">Nothing in the next two weeks.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
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
      {data.offlineTrackers.length > 0 ? (
        <Card>
          <h2 className="display text-2xl">Tracker issues</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {data.offlineTrackers.map((tracker) => (
              <li key={tracker.id}>
                {tracker.serialNumber}
                {tracker.assignments[0] ? (
                  <>
                    {' · '}
                    <Link className="font-semibold text-harbour" to={`/jobs/${tracker.assignments[0].importJob.id}`}>
                      {tracker.assignments[0].importJob.reference}
                    </Link>
                  </>
                ) : (
                  <span className="text-ink/50"> · unassigned</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.activeJobs === 0 ? (
        <EmptyState
          title="No active import jobs"
          description="Create a job to start tracking a vehicle from the UK to Cyprus."
          action={
            <Link to="/jobs/new" className="rounded-xl bg-harbour px-4 py-2 text-sm font-semibold text-paper">
              New job
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
