import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  CHARGE_CATEGORIES,
  COST_CATEGORIES,
  NOTE_VISIBILITIES,
  STATUS_TRANSITIONS,
  getStatusLabel,
  type JobStatus,
} from '@vip/shared';
import { api, ApiError } from '../lib/api';
import { formatCategory, formatDate, money } from '../lib/format';
import { JobTrackingPanel } from '../components/JobTrackingPanel';
import { JobFilesPanel, JobJourneys } from '../components/JobFilesPanel';
import { JobActivity } from '../components/JobActivity';
import { JourneyStepper } from '../components/JourneyStepper';
import { StatusBadge } from '../components/StatusBadge';
import { Card, ErrorBanner, LoadingScreen, fieldClass, primaryBtn, secondaryBtn } from '../components/ui';
import { toLocationPoint } from '../lib/tracking';
import { useSession } from '../lib/session';

type JobDetail = {
  id: string;
  reference: string;
  status: JobStatus;
  originCountry: string;
  destinationCountry: string;
  registrationCountry: string | null;
  expectedDeliveryDate: string | null;
  totals: { totalCost: number; totalCharge: number; margin: number };
  customer: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
  vehicle: {
    make: string | null;
    model: string | null;
    variant: string | null;
    ukRegistration: string | null;
    vin: string | null;
  };
  statusHistory: { id: string; toStatus: string; note: string | null; createdAt: string }[];
  tasks: { id: string; title: string; status: string; dueDate: string | null; createdAt?: string }[];
  costs: { id: string; category: string; description: string; amount: string }[];
  charges: { id: string; category: string; description: string; amount: string }[];
  notes: { id: string; body: string; visibility: string; createdAt: string; author: { name: string } }[];
  journeys: { id: string; type: string; origin: string; destination: string; status: string }[];
  photos: {
    id: string;
    filename: string;
    category: string;
    mimeType: string;
    customerVisible: boolean;
    createdAt: string;
  }[];
  documents: {
    id: string;
    name: string;
    type: string;
    mimeType: string;
    sizeBytes: number;
    customerVisible: boolean;
    createdAt: string;
  }[];
  locationEvents?: Array<{
    id?: string;
    latitude: string | number;
    longitude: string | number;
    accuracy?: string | number | null;
    speed?: string | number | null;
    heading?: string | number | null;
    recordedAt: string;
  }>;
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'files', label: 'Files' },
  { id: 'money', label: 'Money' },
  { id: 'activity', label: 'Activity' },
  { id: 'notes', label: 'Notes' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function JobDetailPage() {
  const { canWrite, currency } = useSession();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const activeTab: TabId = TABS.some((tab) => tab.id === tabParam)
    ? (tabParam as TabId)
    : 'overview';
  const queryClient = useQueryClient();
  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: () => api<JobDetail>(`/import-jobs/${id}`),
    enabled: Boolean(id),
  });
  const job = jobQuery.data;
  const [taskTitle, setTaskTitle] = useState('');
  const [cost, setCost] = useState({ category: 'TRANSPORT', description: '', amount: '' });
  const [charge, setCharge] = useState({ category: 'TRANSPORT', description: '', amount: '' });
  const [note, setNote] = useState({ body: '', visibility: 'INTERNAL' });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job', id] });

  const statusMutation = useMutation({
    mutationFn: (status: JobStatus) =>
      api(`/import-jobs/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: invalidate,
  });
  const taskMutation = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${id}/tasks`, { method: 'POST', body: JSON.stringify({ title: taskTitle }) }),
    onSuccess: () => {
      setTaskTitle('');
      void invalidate();
    },
  });
  const taskStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      api(`/import-jobs/${id}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['job', id] });
      const previous = queryClient.getQueryData<JobDetail>(['job', id]);
      if (previous) {
        queryClient.setQueryData<JobDetail>(['job', id], {
          ...previous,
          tasks: previous.tasks.map((task) =>
            task.id === taskId ? { ...task, status } : task,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['job', id], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', id] });
    },
  });
  const costMutation = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${id}/costs`, {
        method: 'POST',
        body: JSON.stringify({ ...cost, amount: Number(cost.amount) }),
      }),
    onSuccess: () => {
      setCost({ category: 'TRANSPORT', description: '', amount: '' });
      void invalidate();
    },
  });
  const chargeMutation = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${id}/charges`, {
        method: 'POST',
        body: JSON.stringify({ ...charge, amount: Number(charge.amount) }),
      }),
    onSuccess: () => {
      setCharge({ category: 'TRANSPORT', description: '', amount: '' });
      void invalidate();
    },
  });
  const noteMutation = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${id}/notes`, { method: 'POST', body: JSON.stringify(note) }),
    onSuccess: () => {
      setNote({ body: '', visibility: 'INTERNAL' });
      void invalidate();
    },
  });

  // Stable checklist order — never reshuffle when a box is ticked.
  const orderedTasks = useMemo(() => {
    const tasks = jobQuery.data?.tasks ?? [];
    return [...tasks].sort((a, b) => {
      const aAt = a.createdAt ?? '';
      const bAt = b.createdAt ?? '';
      if (aAt !== bAt) return aAt.localeCompare(bAt);
      return a.id.localeCompare(b.id);
    });
  }, [jobQuery.data?.tasks]);

  if (jobQuery.isLoading) return <LoadingScreen label="Loading job…" />;
  if (jobQuery.isError || !job) {
    return (
      <ErrorBanner
        message={jobQuery.error instanceof ApiError ? jobQuery.error.message : 'Could not load this job.'}
      />
    );
  }

  const nextStatuses = STATUS_TRANSITIONS[job.status] ?? [];
  const forward = nextStatuses.filter((status) => status !== 'CANCELLED');
  const canCancel = nextStatuses.includes('CANCELLED');
  const openTasks = orderedTasks.filter((task) => task.status !== 'COMPLETED');

  function moveTo(status: JobStatus) {
    if (status === 'CANCELLED' && !window.confirm('Cancel this import job? This is a terminal status.')) {
      return;
    }
    statusMutation.mutate(status);
  }

  function setTab(next: TabId) {
    const nextParams = new URLSearchParams(params);
    if (next === 'overview') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  }

  return (
    <div className="job-workspace">
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <Link to="/jobs" className="text-sm font-semibold text-harbour">
          ← All jobs
        </Link>
        <Link to={`/tracking?job=${job.id}`} className="text-sm font-semibold text-harbour">
          Open on fleet map
        </Link>
      </div>

      <div className="job-chrome">
        <div className="job-chrome-header rounded-t-2xl bg-ink p-4 text-paper">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.2em] text-mist">{job.reference}</p>
              <h1 className="display text-2xl sm:text-3xl">
                {job.vehicle.make} {job.vehicle.model} {job.vehicle.variant}
              </h1>
              <p className="mt-1 text-sm text-mist">
                <Link to={`/customers/${job.customer.id}`} className="underline-offset-4 hover:underline">
                  {job.customer.firstName} {job.customer.lastName}
                </Link>
                {job.vehicle.ukRegistration ? ` · ${job.vehicle.ukRegistration}` : ''}
                {` · ${job.originCountry} → ${job.destinationCountry}`}
              </p>
            </div>
            <StatusBadge status={job.status} inverted />
          </div>
          {nextStatuses.length > 0 && canWrite ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {forward.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="rounded-xl bg-harbour px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
                  disabled={statusMutation.isPending}
                  onClick={() => moveTo(status)}
                >
                  {getStatusLabel(status)}
                </button>
              ))}
              {canCancel ? (
                <button
                  type="button"
                  className="rounded-xl border border-paper/30 px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
                  disabled={statusMutation.isPending}
                  onClick={() => moveTo('CANCELLED')}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : null}
          {statusMutation.isError ? (
            <div className="mt-3">
              <ErrorBanner
                message={
                  statusMutation.error instanceof Error
                    ? statusMutation.error.message
                    : 'Could not update status'
                }
              />
            </div>
          ) : null}
          <div className="mt-4">
            <JourneyStepper status={job.status} embedded />
          </div>
        </div>

        <div className="job-tabs" role="tablist" aria-label="Job sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`job-tab${activeTab === tab.id ? ' is-active' : ''}`}
              onClick={() => setTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'overview' && openTasks.length > 0 ? ` · ${openTasks.length}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="job-tab-panel">
      {activeTab === 'overview' ? (
        <div className="space-y-4">
          <dl className="grid gap-3 rounded-2xl bg-paper p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-widest text-ink/45">Contact</dt>
              <dd>{job.customer.email ?? job.customer.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-widest text-ink/45">Registration country</dt>
              <dd>{job.registrationCountry ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-widest text-ink/45">Expected delivery</dt>
              <dd>{job.expectedDeliveryDate ? formatDate(job.expectedDeliveryDate) : 'Not set'}</dd>
            </div>
          </dl>

          <section className="grid gap-3 sm:grid-cols-3">
            <button type="button" className="rounded-2xl bg-paper p-4 text-left" onClick={() => setTab('money')}>
              <p className="text-xs uppercase tracking-widest text-ink/50">Internal cost</p>
              <p className="display text-2xl">{money(job.totals.totalCost, currency)}</p>
            </button>
            <button type="button" className="rounded-2xl bg-paper p-4 text-left" onClick={() => setTab('money')}>
              <p className="text-xs uppercase tracking-widest text-ink/50">Customer charges</p>
              <p className="display text-2xl">{money(job.totals.totalCharge, currency)}</p>
            </button>
            <button type="button" className="rounded-2xl bg-harbour p-4 text-left text-paper" onClick={() => setTab('money')}>
              <p className="text-xs uppercase tracking-widest text-mist">Gross margin</p>
              <p className="display text-2xl">{money(job.totals.margin, currency)}</p>
            </button>
          </section>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Tasks</h2>
              {openTasks.length > 0 ? (
                <span className="text-xs text-ink/50">{openTasks.length} open</span>
              ) : null}
            </div>
            {orderedTasks.length === 0 ? (
              <p className="mt-2 text-sm text-ink/50">No tasks yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {orderedTasks.map((task) => {
                  const done = task.status === 'COMPLETED';
                  return (
                    <li key={task.id} className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-harbour"
                        disabled={!canWrite || taskStatus.isPending}
                        checked={done}
                        onChange={() =>
                          taskStatus.mutate({ taskId: task.id, status: done ? 'TODO' : 'COMPLETED' })
                        }
                      />
                      <span className={done ? 'text-ink/45 line-through' : ''}>{task.title}</span>
                      {task.dueDate ? (
                        <span className="ml-auto text-xs text-ink/45">{formatDate(task.dueDate)}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {canWrite ? (
              <form
                className="mt-4 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (taskTitle.trim()) taskMutation.mutate();
                }}
              >
                <input
                  className={fieldClass}
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="Add a task"
                />
                <button className={primaryBtn} type="submit">
                  Add
                </button>
              </form>
            ) : null}
          </Card>

          <JobJourneys jobId={job.id} journeys={job.journeys ?? []} />
        </div>
      ) : null}

      {activeTab === 'tracking' ? (
        <div className="space-y-4">
          <JobTrackingPanel
            jobId={job.id}
            lastKnown={job.locationEvents?.[0] ? toLocationPoint(job.locationEvents[0]) : null}
          />
        </div>
      ) : null}

      {activeTab === 'files' ? (
        <JobFilesPanel jobId={job.id} photos={job.photos ?? []} documents={job.documents ?? []} />
      ) : null}

      {activeTab === 'money' ? (
        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="font-semibold">Internal costs</h2>
            <p className="text-xs text-ink/45">Never shown to the customer.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {job.costs.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span>
                    {item.description}
                    <span className="block text-xs text-ink/45">{formatCategory(item.category)}</span>
                  </span>
                  <span className="font-semibold">{money(item.amount, currency)}</span>
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="mt-4 grid gap-2">
                <select
                  className={fieldClass}
                  value={cost.category}
                  onChange={(event) => setCost({ ...cost, category: event.target.value })}
                >
                  {COST_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {formatCategory(item)}
                    </option>
                  ))}
                </select>
                <input
                  className={fieldClass}
                  placeholder="Description"
                  value={cost.description}
                  onChange={(event) => setCost({ ...cost, description: event.target.value })}
                />
                <input
                  className={fieldClass}
                  placeholder="Amount"
                  value={cost.amount}
                  onChange={(event) => setCost({ ...cost, amount: event.target.value })}
                />
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => costMutation.mutate()}
                  disabled={!cost.description || !cost.amount}
                >
                  Add cost
                </button>
              </div>
            ) : null}
          </Card>
          <Card>
            <h2 className="font-semibold">Customer charges</h2>
            <p className="text-xs text-ink/45">What the customer is billed.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {job.charges.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span>
                    {item.description}
                    <span className="block text-xs text-ink/45">{formatCategory(item.category)}</span>
                  </span>
                  <span className="font-semibold">{money(item.amount, currency)}</span>
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="mt-4 grid gap-2">
                <select
                  className={fieldClass}
                  value={charge.category}
                  onChange={(event) => setCharge({ ...charge, category: event.target.value })}
                >
                  {CHARGE_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {formatCategory(item)}
                    </option>
                  ))}
                </select>
                <input
                  className={fieldClass}
                  placeholder="Description"
                  value={charge.description}
                  onChange={(event) => setCharge({ ...charge, description: event.target.value })}
                />
                <input
                  className={fieldClass}
                  placeholder="Amount"
                  value={charge.amount}
                  onChange={(event) => setCharge({ ...charge, amount: event.target.value })}
                />
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => chargeMutation.mutate()}
                  disabled={!charge.description || !charge.amount}
                >
                  Add charge
                </button>
              </div>
            ) : null}
          </Card>
        </section>
      ) : null}

      {activeTab === 'activity' ? <JobActivity jobId={job.id} /> : null}

      {activeTab === 'notes' ? (
        <Card>
          <h2 className="font-semibold">Notes</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {job.notes.map((item) => (
              <li key={item.id} className="rounded-xl bg-sand/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-ink/45">
                  {item.visibility === 'CUSTOMER' ? 'Visible to customer' : 'Internal only'} ·{' '}
                  {item.author.name}
                </p>
                <p className="mt-1">{item.body}</p>
              </li>
            ))}
          </ul>
          {canWrite ? (
            <>
              <textarea
                className={`${fieldClass} mt-4 min-h-24`}
                value={note.body}
                onChange={(event) => setNote({ ...note, body: event.target.value })}
                placeholder="Write an update"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  className={fieldClass}
                  value={note.visibility}
                  onChange={(event) => setNote({ ...note, visibility: event.target.value })}
                >
                  {NOTE_VISIBILITIES.map((item) => (
                    <option key={item} value={item}>
                      {item === 'CUSTOMER' ? 'Visible to customer' : 'Internal only'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={primaryBtn}
                  onClick={() => noteMutation.mutate()}
                  disabled={!note.body.trim()}
                >
                  Add note
                </button>
              </div>
            </>
          ) : null}
        </Card>
      ) : null}
      </div>
    </div>
  );
}
