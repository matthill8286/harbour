import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Alert, Avatar, Badge, Button, Card, Heading, Progress, Row, Text } from '@atomic-ui/ui-react';
import { api } from '../../lib/api';
import { formatCategory, formatDate, relativeTime } from '../../lib/format';
import type { JobTracking } from '../../lib/tracking';
import { AuthenticatedImage } from '../../components/AuthenticatedImage';
import { AddLegDialog, CancelJobDialog, TaskDialog, type TaskDraft } from './dialogs';
import { countryName } from './countries';
import { closedAt } from './history';
import { useJobStatus } from './useJobStatus';
import type { JobDetail } from './types';
import './OverviewTab.css';

type Task = JobDetail['tasks'][number];

const today = () => new Date().toISOString().slice(0, 10);
const isDone = (task: Task) => task.status === 'COMPLETED';
const isOverdue = (task: Task) => !isDone(task) && task.status !== 'CANCELLED' && Boolean(task.dueDate) && task.dueDate!.slice(0, 10) < today();

export function OverviewTab({ job, onTab }: { job: JobDetail; onTab: (tab: string) => string }) {
  const queryClient = useQueryClient();
  const [taskDialog, setTaskDialog] = useState<TaskDraft | null>(null);
  const [legDialog, setLegDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  // The time the tab opened, so a tracker's freshness does not change between renders.
  const [now] = useState(() => Date.now());

  const { closed, editable, next, canCancel, move, label, progress } = useJobStatus(job);
  const ending = closedAt(job);

  const tracking = useQuery({
    queryKey: ['tracking', job.id],
    queryFn: () => api<JobTracking>(`/import-jobs/${job.id}/tracking`),
  });

  const toggle = useMutation({
    mutationFn: (task: Task) =>
      api(`/import-jobs/${job.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: isDone(task) ? 'TODO' : 'COMPLETED' }) }),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: ['job', job.id] });
      const previous = queryClient.getQueryData<JobDetail>(['job', job.id]);
      if (previous) {
        queryClient.setQueryData<JobDetail>(['job', job.id], {
          ...previous,
          tasks: previous.tasks.map((t) => (t.id === task.id ? { ...t, status: isDone(task) ? 'TODO' : 'COMPLETED' } : t)),
        });
      }
      return { previous };
    },
    onError: (_error, _task, context) => {
      if (context?.previous) queryClient.setQueryData(['job', job.id], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['job', job.id] }),
  });

  // The checklist keeps the order the tasks were added in, so ticking one never moves it.
  const tasks = useMemo(() => [...job.tasks].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)), [job.tasks]);
  const overdue = tasks.filter(isOverdue).length;
  const latestNote = job.notes.length ? [...job.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : null;
  const photo = job.photos[0];
  const customer = `${job.customer.firstName} ${job.customer.lastName}`.trim();
  const vehicle = [job.vehicle.make, job.vehicle.model, job.vehicle.variant].filter(Boolean).join(' ') || 'Vehicle';
  const tracker = tracking.data?.tracker ?? null;
  const live = tracker?.lastSeenAt ? now - new Date(tracker.lastSeenAt).getTime() < 6 * 60 * 60 * 1000 : false;

  return (
    <div className="job-overview">
      <div className="job-overview-main">
        <section className="job-hero" aria-label={`${vehicle}, ${label(job.status)}`}>
          {photo ? <AuthenticatedImage path={`/import-jobs/${job.id}/photos/${photo.id}`} alt="" className="job-hero-photo" /> : null}
          <div className="job-hero-top">
            <div className="job-hero-badges">
              <Badge tone="inverse">{label(job.status)}</Badge>
              {job.vehicle.ukRegistration ? <Badge>{job.vehicle.ukRegistration}</Badge> : null}
              <Badge>{`${countryName(job.originCountry)} → ${countryName(job.destinationCountry)}`}</Badge>
            </div>
            <Link to={`/customers/${job.customer.id}`} className="job-hero-customer">
              <Avatar fullName={customer} size="sm" />
              <span>
                <strong>{customer}</strong>
                <small>Customer</small>
              </span>
            </Link>
          </div>
          <div className="job-hero-bar">
            <Progress look="bars" label="Journey" steps={progress.steps} current={progress.current} />
            {editable ? (
              <div className="job-hero-actions">
                {canCancel ? (
                  <Button variant="subtle" onClick={() => setCancelDialog(true)}>
                    Cancel job
                  </Button>
                ) : null}
                {next ? (
                  <Button iconAfter="arrow-right" busy={move.isPending} busyLabel="Moving the job" onClick={() => move.mutate(next)}>
                    {`Move to ${label(next)}`}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {move.isError ? (
            <Alert tone="danger" heading="The job did not move">
              {move.error instanceof Error ? move.error.message : 'Try again.'}
            </Alert>
          ) : null}
        </section>

        <dl className="job-facts">
          <div>
            <dt>Contact</dt>
            <dd>{job.customer.email ?? job.customer.phone ?? 'No contact details'}</dd>
          </div>
          <div>
            <dt>Registered in (EU)</dt>
            <dd>{job.registrationCountry ? countryName(job.registrationCountry) : 'Not set'}</dd>
          </div>
          <div>
            {closed && ending ? (
              <>
                <dt>{`${job.status === 'COMPLETED' ? 'Completed' : 'Cancelled'} ${formatDate(ending.createdAt)}`}</dt>
                <dd>{job.expectedDeliveryDate ? `Was due ${formatDate(job.expectedDeliveryDate)}` : 'No delivery date was set'}</dd>
              </>
            ) : (
              <>
                <dt>Expected delivery</dt>
                <dd>{job.expectedDeliveryDate ? formatDate(job.expectedDeliveryDate) : 'Not set'}</dd>
              </>
            )}
          </div>
        </dl>

        <Card className="job-card">
          <div className="job-card-head">
            <div>
              <Heading level={2} size="md">
                Journey legs
              </Heading>
              <Text size="sm" tone="muted">
                Road and ferry legs, in order
              </Text>
            </div>
            {editable ? (
              <Button variant="subtle" size="sm" iconBefore="plus" onClick={() => setLegDialog(true)}>
                Add leg
              </Button>
            ) : null}
          </div>
          {job.journeys.length === 0 ? (
            <Text tone="muted">No legs yet.</Text>
          ) : (
            <ol className="job-legs">
              {job.journeys.map((leg, i) => (
                <li key={leg.id} className={`job-leg is-${leg.status.toLowerCase().replace('_', '-')}`}>
                  <div className="job-leg-head">
                    <span className="job-leg-number" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <Badge tone={leg.status === 'COMPLETED' ? 'inverse' : leg.status === 'IN_PROGRESS' ? 'solid' : 'neutral'}>
                      {formatCategory(leg.status)}
                    </Badge>
                  </div>
                  <strong>{`${leg.origin} → ${leg.destination}`}</strong>
                  <Text size="sm" tone="muted">
                    {formatCategory(leg.type)}
                  </Text>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <aside className="job-overview-side" aria-label="Tasks, tracker and latest update">
        <Card className="job-card">
          <div className="job-card-head">
            <Heading level={2} size="md">
              Tasks
            </Heading>
            {closed ? <Badge>Stopped</Badge> : overdue > 0 ? <Badge tone="danger">{`${overdue} overdue`}</Badge> : null}
          </div>
          {tasks.length === 0 ? <Text tone="muted">No tasks yet.</Text> : null}
          <div role="list">
            {tasks.map((task) => {
              const done = isDone(task);
              const meta = done
                ? 'Completed'
                : [task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No due date', isOverdue(task) ? 'overdue' : null].filter(Boolean).join(' · ');
              return (
                <Row key={task.id} role="listitem" heading={task.title} meta={meta} muted={done}>
                  <button
                    slot="start"
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={`${task.title} done`}
                    className={`job-tick${done ? ' is-done' : ''}`}
                    disabled={!editable}
                    onClick={() => toggle.mutate(task)}
                  />
                  <span slot="end" className="job-task-end">
                    <Badge>{formatCategory(task.priority)}</Badge>
                    {editable ? (
                      <Button
                        icon="pencil"
                        label={`Edit ${task.title}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => setTaskDialog({ id: task.id, title: task.title, priority: task.priority, dueDate: task.dueDate?.slice(0, 10) ?? '' })}
                      />
                    ) : null}
                  </span>
                </Row>
              );
            })}
          </div>
          {editable ? (
            <Button variant="subtle" full iconBefore="plus" onClick={() => setTaskDialog({ title: '', priority: 'MEDIUM', dueDate: '' })}>
              Add a task
            </Button>
          ) : null}
        </Card>

        <Card className="job-card">
          <div className="job-card-head">
            <Heading level={2} size="md">
              Tracker
            </Heading>
            {closed ? <Badge>Off</Badge> : tracker ? live ? <Badge tone="solid">Live</Badge> : <Badge tone="danger">Silent</Badge> : <Badge>None</Badge>}
          </div>
          {tracking.isLoading ? (
            <Text tone="muted">Loading the tracker…</Text>
          ) : tracker ? (
            <dl className="job-tracker">
              <div>
                <dt>Unit</dt>
                <dd>{tracker.serialNumber}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>{relativeTime(tracker.lastSeenAt)}</dd>
              </div>
              <div>
                <dt>Battery</dt>
                <dd>{tracker.batteryLevel == null ? 'Unknown' : `${tracker.batteryLevel}%`}</dd>
              </div>
            </dl>
          ) : (
            <Text tone="muted">No tracker is fitted to this vehicle.</Text>
          )}
          <div className="job-tracker-actions">
            <Button variant="secondary" href={onTab('tracking')}>
              Open tracking
            </Button>
            {editable ? (
              <Button variant="subtle" href={onTab('tracking')}>
                {tracker ? 'Replace' : 'Assign'}
              </Button>
            ) : null}
          </div>
        </Card>

        <Card className="job-card">
          <div className="job-card-head">
            <Heading level={2} size="md">
              Latest update
            </Heading>
            {latestNote ? latestNote.visibility === 'CUSTOMER' ? <Badge tone="solid">Visible to customer</Badge> : <Badge>Internal</Badge> : null}
          </div>
          {latestNote ? (
            <>
              <p className="job-note">{latestNote.body}</p>
              <div className="job-note-foot">
                <Text size="sm" tone="muted">{`${latestNote.author.name} · ${formatDate(latestNote.createdAt)}`}</Text>
                <Link to={onTab('notes')} className="job-link">
                  All notes →
                </Link>
              </div>
            </>
          ) : (
            <Text tone="muted">No notes yet.</Text>
          )}
        </Card>
      </aside>

      {taskDialog ? <TaskDialog jobId={job.id} task={taskDialog} onClose={() => setTaskDialog(null)} /> : null}
      {legDialog ? <AddLegDialog jobId={job.id} onClose={() => setLegDialog(false)} /> : null}
      {cancelDialog ? <CancelJobDialog jobId={job.id} onClose={() => setCancelDialog(false)} /> : null}
    </div>
  );
}
