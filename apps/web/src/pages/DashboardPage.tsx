import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, DateTile, EmptyState, Heading, Progress, Row, Select, StatTile, Text } from '@atomic-ui/ui-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { routeProgress, useWorkflows } from '../lib/workflows';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import './DashboardPage.css';

type Dashboard = {
  activeJobs: number;
  byRoute: {
    id: string;
    name: string;
    shortLabel: string;
    isDefault: boolean;
    activeJobs: number;
    completed: number;
    stages: { id: string; name: string; count: number }[];
  }[];
  overdueTasks: {
    id: string;
    title: string;
    dueDate: string | null;
    importJob: { id: string; reference: string };
  }[];
  upcomingDeliveries: {
    id: string;
    reference: string;
    status: string;
    routeId: string | null;
    expectedDeliveryDate: string;
    customer: { firstName: string; lastName: string };
    vehicle: { make: string | null; model: string | null; ukRegistration?: string | null };
  }[];
  opsAlerts: {
    kind: 'STALE_TRACKER' | 'NEAR_DESTINATION';
    importJobId: string;
    reference: string;
    title: string;
    detail: string;
    trackerSerial?: string;
    aiSummary?: string;
  }[];
};

const vehicleName = (vehicle: { make: string | null; model: string | null }) => [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
const customerName = (customer: { firstName: string; lastName: string }) => `${customer.firstName} ${customer.lastName}`.trim();
const day = (iso: string) => iso.slice(0, 10);

export function DashboardPage() {
  const { canWrite, workspace } = useSession();
  const workflows = useWorkflows();
  const [params, setParams] = useSearchParams();
  const many = workflows.routes.length > 1;
  const routeId = many ? (params.get('route') ?? '') : '';
  const chosen = workflows.routes.find((r) => r.id === routeId);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', routeId],
    queryFn: () => api<Dashboard>(`/dashboard${routeId ? `?route=${encodeURIComponent(routeId)}` : ''}`),
  });

  const picker = many ? (
    <Select
      className="board-route"
      label="Route"
      options={[{ value: '', label: 'All routes' }, ...workflows.routes.map((r) => ({ value: r.id, label: r.name }))]}
      value={routeId}
      onChange={(event) => setParams(event.detail.value ? { route: event.detail.value } : {}, { replace: true })}
    />
  ) : null;
  const lead = chosen ? `What needs attention on ${chosen.name} today.` : undefined;

  if (isLoading) return <LoadingScreen label="Loading the Board…" />;

  if (isError || !data) {
    return (
      <div className="board">
        <BoardHeading lead={lead} picker={picker} />
        <Alert tone="danger" heading="The Board could not load">
          Check your connection, then try again.
          <div className="board-retry">
            <Button variant="secondary" busy={isFetching} busyLabel="Trying again" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  const arriving = data.upcomingDeliveries;
  const next = arriving[0];
  const jobsLink = (route: string, stage: string) => `/jobs?${new URLSearchParams({ ...(many ? { route } : {}), stage })}`;
  const single = data.byRoute.length === 1 ? data.byRoute[0] : null;
  const arrivingCaption = `${arriving.length} arriving in the next two weeks`;

  return (
    <div className="board">
      <PhoneHeader>
        <div className="board-phone">
          <Text size="sm">{workspace}</Text>
          <p className="board-phone-count">
            <span className="board-phone-number">{data.activeJobs}</span>
            <span>
              <strong>active import jobs</strong>
              <small>{arrivingCaption}</small>
            </span>
          </p>
        </div>
      </PhoneHeader>

      {picker ? <div className="board-route-phone">{picker}</div> : null}

      <BoardHeading
        lead={lead}
        picker={picker}
        action={
          <Button variant="secondary" href="/jobs" iconAfter="arrow-right">
            Browse all jobs
          </Button>
        }
      />

      {data.activeJobs === 0 ? (
        <EmptyState
          heading="No active import jobs"
          lead={canWrite ? 'Create a job to follow a vehicle from collection to delivery.' : 'There are no active imports in this workspace yet.'}
          framed
        >
          {canWrite ? (
            <Button slot="actions" href="/jobs/new" iconBefore="plus">
              New job
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <div className="board-row board-row-top">
            <StatTile
              className="board-lead"
              label="Active import jobs"
              value={String(data.activeJobs)}
              caption={arrivingCaption}
              href="/jobs"
              tone="brand"
              size="lg"
            />
            <Card className="board-card">
              <Heading level={2} size="md">
                {single ? 'Jobs by stage' : 'Jobs by route and stage'}
              </Heading>
              {single ? (
                <ul className="board-stages" role="list">
                  {[...single.stages, { id: 'completed', name: 'Completed', count: single.completed }].map((item) => (
                    <li key={item.id}>
                      <StatTile label={item.name} value={String(item.count)} href={jobsLink(single.id, item.id)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="board-routes" role="list">
                  {data.byRoute.map((route) => (
                    <div key={route.id} className="board-route-row" role="listitem">
                      <div className="board-route-name">
                        <strong>{route.name}</strong>
                        <Text size="sm" tone="muted">{`${route.activeJobs} active`}</Text>
                      </div>
                      <ul className="board-stages is-compact" role="list" aria-label={`${route.name} stages`}>
                        {route.stages.map((item) => (
                          <li key={item.id}>
                            <StatTile label={item.name} value={String(item.count)} href={jobsLink(route.id, item.id)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="board-row board-row-middle">
            <Card className="board-card">
              <div className="board-card-head">
                <Heading level={2} size="md">
                  Needs attention
                </Heading>
                {data.overdueTasks.length > 0 ? <Badge tone="danger">{`${data.overdueTasks.length} overdue`}</Badge> : null}
              </div>
              {data.overdueTasks.length === 0 ? (
                <Text tone="muted">No overdue tasks.</Text>
              ) : (
                <div role="list">
                  {data.overdueTasks.map((task) => (
                    <Row
                      key={task.id}
                      role="listitem"
                      heading={task.title}
                      meta={[task.importJob.reference, task.dueDate ? `Due ${formatDate(task.dueDate)}` : null].filter(Boolean).join(' · ')}
                      href={`/jobs/${task.importJob.id}?tab=overview`}
                    >
                      <span slot="start" className="board-dot" aria-hidden="true" />
                    </Row>
                  ))}
                </div>
              )}
            </Card>

            <Card className="board-card">
              <div className="board-card-head">
                <Heading level={2} size="md">
                  Arriving soon
                </Heading>
                <Text size="sm" tone="muted">
                  Next two weeks
                </Text>
              </div>
              {arriving.length === 0 ? (
                <Text tone="muted">Nothing is due in the next two weeks.</Text>
              ) : (
                <div role="list">
                  {arriving.map((job) => (
                    <Row
                      key={job.id}
                      role="listitem"
                      heading={job.reference}
                      meta={`${vehicleName(job.vehicle)} · ${customerName(job.customer)}`}
                      href={`/jobs/${job.id}`}
                    >
                      <DateTile slot="start" date={day(job.expectedDeliveryDate)} />
                      <Badge slot="end">{workflows.label(job.routeId, job.status)}</Badge>
                    </Row>
                  ))}
                </div>
              )}
            </Card>

            {next ? (
              <section className="board-next" aria-labelledby="board-next-heading">
                <div className="board-next-badges">
                  <Badge>Arriving next</Badge>
                  <Badge tone="inverse">{next.reference}</Badge>
                </div>
                <Heading level={2} size="2xl" id="board-next-heading">
                  {vehicleName(next.vehicle)}
                </Heading>
                <Text size="sm">{[next.vehicle.ukRegistration, customerName(next.customer)].filter(Boolean).join(' · ')}</Text>
                <div className="board-next-status">
                  <Progress look="bars" label="Journey" {...routeProgress(workflows.routeOf(next.routeId), next.status)} />
                  <div className="board-next-line">
                    <span>
                      <strong>{workflows.label(next.routeId, next.status)}</strong>
                      <Text size="sm" tone="muted">{`Expected delivery ${formatDate(next.expectedDeliveryDate)}`}</Text>
                    </span>
                    <Button icon="arrow-up-right" label={`Open ${next.reference}`} href={`/jobs/${next.id}`} />
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          {data.opsAlerts.length > 0 ? (
            <Card className="board-card">
              <div className="board-card-head">
                <div>
                  <Heading level={2} size="md">
                    GPS alerts
                  </Heading>
                  <Text size="sm" tone="muted">
                    Trackers that went silent and vehicles close to their destination
                  </Text>
                </div>
                <Button variant="secondary" href="/tracking">
                  Live map
                </Button>
              </div>
              <ul className="board-alerts" role="list">
                {data.opsAlerts.map((alert) => (
                  <li key={`${alert.kind}-${alert.importJobId}`} className="board-alert">
                    <div className="board-alert-head">
                      <strong>
                        {alert.title} · {alert.reference}
                      </strong>
                      {alert.kind === 'STALE_TRACKER' ? <Badge tone="danger">No signal</Badge> : <Badge tone="solid">Arriving</Badge>}
                    </div>
                    <Text size="sm" tone="muted">
                      {alert.aiSummary ?? alert.detail}
                    </Text>
                    <a className="board-alert-link" href={`/jobs/${alert.importJobId}?tab=tracking`}>
                      Open tracking<span className="board-visually-hidden"> for {alert.reference}</span> →
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function BoardHeading({ action, picker, lead }: { action?: ReactNode; picker?: ReactNode; lead?: string }) {
  return (
    <div className="board-heading">
      <div>
        <Heading level={1} size="4xl" className="board-title">
          Board
        </Heading>
        <Text tone="muted">{lead ?? 'What needs attention in this workspace today.'}</Text>
      </div>
      <div className="board-heading-actions">
        {picker}
        {action}
      </div>
    </div>
  );
}
