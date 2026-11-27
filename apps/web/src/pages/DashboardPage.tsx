import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  DateTile,
  EmptyState,
  Heading,
  Progress,
  Row,
  StatTile,
  Text,
} from '@atomic-ui/ui-react';
import { JOB_STAGE_LABELS, JOB_STAGES, getJobStage, getStatusLabel, type JobStage, type JobStatus } from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import './DashboardPage.css';

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

/** The stages a job moves through on the way, for the journey bars. */
const JOURNEY: JobStage[] = JOB_STAGES.filter((stage) => stage !== 'completed' && stage !== 'cancelled');
const journeySteps = JOURNEY.map((stage) => ({ id: stage, label: JOB_STAGE_LABELS[stage] }));

const vehicleName = (vehicle: { make: string | null; model: string | null }) =>
  [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
const customerName = (customer: { firstName: string; lastName: string }) => `${customer.firstName} ${customer.lastName}`.trim();
const day = (iso: string) => iso.slice(0, 10);

export function DashboardPage() {
  const { canWrite, workspace } = useSession();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
  });

  if (isLoading) return <LoadingScreen label="Loading the Board…" />;

  if (isError || !data) {
    return (
      <div className="board">
        <BoardHeading />
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
  const stages = data.byStage.filter((item) => item.stage !== 'cancelled');
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

      <BoardHeading
        action={
          <Button variant="secondary" href="/jobs" iconAfter="arrow-right">
            Browse all jobs
          </Button>
        }
      />

      {data.activeJobs === 0 ? (
        <EmptyState
          heading="No active import jobs"
          lead={
            canWrite
              ? 'Create a job to follow a vehicle from collection to delivery.'
              : 'There are no active imports in this workspace yet.'
          }
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
                Jobs by stage
              </Heading>
              <ul className="board-stages" role="list">
                {stages.map((item) => (
                  <li key={item.stage}>
                    <StatTile
                      label={JOB_STAGE_LABELS[item.stage as JobStage] ?? item.label}
                      value={String(item.count)}
                      href={`/jobs?stage=${encodeURIComponent(item.stage)}`}
                    />
                  </li>
                ))}
              </ul>
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
                      <Badge slot="end">{getStatusLabel(job.status)}</Badge>
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
                <Text size="sm">
                  {[next.vehicle.ukRegistration, customerName(next.customer)].filter(Boolean).join(' · ')}
                </Text>
                <div className="board-next-status">
                  <Progress look="bars" label="Journey" steps={journeySteps} current={getJobStage(next.status)} />
                  <div className="board-next-line">
                    <span>
                      <strong>{getStatusLabel(next.status)}</strong>
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

function BoardHeading({ action }: { action?: ReactNode }) {
  return (
    <div className="board-heading">
      <div>
        <Heading level={1} size="4xl" className="board-title">
          Board
        </Heading>
        <Text tone="muted">What needs attention in this workspace today.</Text>
      </div>
      {action}
    </div>
  );
}
