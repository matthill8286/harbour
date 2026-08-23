import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  CHARGE_CATEGORIES,
  COST_CATEGORIES,
  NOTE_VISIBILITIES,
  STATUS_TRANSITIONS,
  getStatusLabel,
  type JobStatus,
} from '@vip/shared';
import { api, ApiError } from '../lib/api';
import { formatCategory, formatDate, formatDateTime, money } from '../lib/format';
import { JobTrackingPanel } from '../components/JobTrackingPanel';
import { JobFilesPanel, JobJourneys } from '../components/JobFilesPanel';
import { JourneyStepper } from '../components/JourneyStepper';
import { StatusBadge } from '../components/StatusBadge';
import { Card, ErrorBanner, LoadingScreen, fieldClass, primaryBtn, secondaryBtn } from '../components/ui';

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
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
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
};

export function JobDetailPage() {
  const { id = '' } = useParams();
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
    onSuccess: invalidate,
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

  function moveTo(status: JobStatus) {
    if (status === 'CANCELLED' && !window.confirm('Cancel this import job? This is a terminal status.')) {
      return;
    }
    statusMutation.mutate(status);
  }

  return (
    <div className="space-y-5">
      <Link to="/jobs" className="text-sm font-semibold text-harbour">
        ← All jobs
      </Link>
      <div className="rounded-3xl bg-ink p-5 text-paper">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-mist">{job.reference}</p>
            <h1 className="display text-4xl">
              {job.vehicle.make} {job.vehicle.model} {job.vehicle.variant}
            </h1>
            <p className="mt-1 text-mist">
              <Link to={`/customers/${job.customer.id}`} className="text-mist underline-offset-4 hover:underline">
                {job.customer.firstName} {job.customer.lastName}
              </Link>
              {job.vehicle.ukRegistration ? ` · ${job.vehicle.ukRegistration}` : ''}
              {` · ${job.originCountry} → ${job.destinationCountry}`}
            </p>
          </div>
          <StatusBadge status={job.status} inverted />
        </div>
        <dl className="mt-4 grid gap-3 text-sm text-mist sm:grid-cols-3">
          <div>
            <dt className="text-[11px] uppercase tracking-widest">Customer</dt>
            <dd className="text-paper">
              {job.customer.email ?? job.customer.phone ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-widest">Registration country</dt>
            <dd className="text-paper">{job.registrationCountry ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-widest">Expected delivery</dt>
            <dd className="text-paper">
              {job.expectedDeliveryDate ? formatDate(job.expectedDeliveryDate) : 'Not set'}
            </dd>
          </div>
        </dl>
      </div>

      <JourneyStepper status={job.status} />

      {nextStatuses.length > 0 ? (
        <Card>
          <p className="text-xs uppercase tracking-widest text-ink/50">Next action</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {forward.map((status) => (
              <button
                key={status}
                type="button"
                className={primaryBtn}
                disabled={statusMutation.isPending}
                onClick={() => moveTo(status)}
              >
                Move to {getStatusLabel(status)}
              </button>
            ))}
            {canCancel ? (
              <button
                type="button"
                className={secondaryBtn}
                disabled={statusMutation.isPending}
                onClick={() => moveTo('CANCELLED')}
              >
                Cancel job
              </button>
            ) : null}
          </div>
          {statusMutation.isError ? (
            <div className="mt-3">
              <ErrorBanner
                message={statusMutation.error instanceof Error ? statusMutation.error.message : 'Could not update status'}
              />
            </div>
          ) : null}
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-widest text-ink/50">Internal cost</p>
          <p className="display text-3xl">{money(job.totals.totalCost)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-widest text-ink/50">Customer charges</p>
          <p className="display text-3xl">{money(job.totals.totalCharge)}</p>
        </Card>
        <div className="rounded-2xl bg-harbour p-4 text-paper">
          <p className="text-xs uppercase tracking-widest text-mist">Gross margin</p>
          <p className="display text-3xl">{money(job.totals.margin)}</p>
        </div>
      </section>

      <JobTrackingPanel jobId={job.id} />
      <JobJourneys jobId={job.id} journeys={job.journeys ?? []} />
      <JobFilesPanel jobId={job.id} photos={job.photos ?? []} documents={job.documents ?? []} />

      <Card>
        <h2 className="display text-2xl">Timeline</h2>
        <ol className="relative mt-4 ml-2 space-y-4 border-l border-ink/10 pl-5">
          {job.statusHistory.map((item, index) => (
            <li key={item.id} className="relative">
              <span
                className={`absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full ${
                  index === job.statusHistory.length - 1 ? 'bg-harbour' : 'bg-ink/30'
                }`}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-semibold">{getStatusLabel(item.toStatus as JobStatus)}</p>
                <time className="text-xs text-ink/45">{formatDateTime(item.createdAt)}</time>
              </div>
              {item.note ? <p className="text-sm text-ink/60">{item.note}</p> : null}
            </li>
          ))}
        </ol>
      </Card>


      <Card>
        <h2 className="display text-2xl">Tasks</h2>
        {job.tasks.length === 0 ? (
          <p className="mt-2 text-sm text-ink/50">No tasks yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {job.tasks.map((task) => {
              const done = task.status === 'COMPLETED';
              return (
                <li key={task.id} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-harbour"
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
      </Card>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="display text-2xl">Internal costs</h2>
          <p className="text-xs text-ink/45">Never shown to the customer.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {job.costs.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>
                  {item.description}
                  <span className="block text-xs text-ink/45">{formatCategory(item.category)}</span>
                </span>
                <span className="font-semibold">{money(item.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2">
            <select className={fieldClass} value={cost.category} onChange={(event) => setCost({ ...cost, category: event.target.value })}>
              {COST_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {formatCategory(item)}
                </option>
              ))}
            </select>
            <input className={fieldClass} placeholder="Description" value={cost.description} onChange={(event) => setCost({ ...cost, description: event.target.value })} />
            <input className={fieldClass} placeholder="Amount" value={cost.amount} onChange={(event) => setCost({ ...cost, amount: event.target.value })} />
            <button type="button" className={secondaryBtn} onClick={() => costMutation.mutate()} disabled={!cost.description || !cost.amount}>
              Add cost
            </button>
          </div>
        </Card>
        <Card>
          <h2 className="display text-2xl">Customer charges</h2>
          <p className="text-xs text-ink/45">What the customer is billed.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {job.charges.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>
                  {item.description}
                  <span className="block text-xs text-ink/45">{formatCategory(item.category)}</span>
                </span>
                <span className="font-semibold">{money(item.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2">
            <select className={fieldClass} value={charge.category} onChange={(event) => setCharge({ ...charge, category: event.target.value })}>
              {CHARGE_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {formatCategory(item)}
                </option>
              ))}
            </select>
            <input className={fieldClass} placeholder="Description" value={charge.description} onChange={(event) => setCharge({ ...charge, description: event.target.value })} />
            <input className={fieldClass} placeholder="Amount" value={charge.amount} onChange={(event) => setCharge({ ...charge, amount: event.target.value })} />
            <button type="button" className={secondaryBtn} onClick={() => chargeMutation.mutate()} disabled={!charge.description || !charge.amount}>
              Add charge
            </button>
          </div>
        </Card>
      </section>

      <Card>
        <h2 className="display text-2xl">Notes</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {job.notes.map((item) => (
            <li key={item.id} className="rounded-xl bg-sand/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-ink/45">
                {item.visibility === 'CUSTOMER' ? 'Visible to customer' : 'Internal only'} · {item.author.name}
              </p>
              <p className="mt-1">{item.body}</p>
            </li>
          ))}
        </ul>
        <textarea
          className={`${fieldClass} mt-4 min-h-24`}
          value={note.body}
          onChange={(event) => setNote({ ...note, body: event.target.value })}
          placeholder="Write an update"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <select className={fieldClass} value={note.visibility} onChange={(event) => setNote({ ...note, visibility: event.target.value })}>
            {NOTE_VISIBILITIES.map((item) => (
              <option key={item} value={item}>
                {item === 'CUSTOMER' ? 'Visible to customer' : 'Internal only'}
              </option>
            ))}
          </select>
          <button type="button" className={primaryBtn} onClick={() => noteMutation.mutate()} disabled={!note.body.trim()}>
            Add note
          </button>
        </div>
      </Card>
    </div>
  );
}
