import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Chip, EmptyState, FilterChip, Heading, Select, Table, Text, TextInput } from '@atomic-ui/ui-react';
import { TERMINAL_LABELS, routeStatusCodes } from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { routeProgress, useWorkflows } from '../lib/workflows';
import { openRowLink } from '../lib/tableRows';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import './JobsPage.css';

type JobListItem = {
  id: string;
  reference: string;
  status: string;
  routeId: string | null;
  route: { id: string; name: string; shortLabel: string } | null;
  originCountry: string;
  destinationCountry: string;
  expectedDeliveryDate: string | null;
  customer: { firstName: string; lastName: string };
  vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
};

/** How many jobs show before Load more. */
const PAGE = 25;

const COLUMNS = [
  { key: 'reference', label: 'Reference' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'plate', label: 'Plate' },
  { key: 'customer', label: 'Customer' },
  { key: 'corridor', label: 'Corridor' },
  { key: 'status', label: 'Status' },
  { key: 'expected', label: 'Expected' },
];

/** Completed and Cancelled close a job on every route. */
const CLOSING = [
  { value: 'COMPLETED', label: TERMINAL_LABELS.COMPLETED },
  { value: 'CANCELLED', label: TERMINAL_LABELS.CANCELLED },
];

const vehicleName = (job: JobListItem) => [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
const customerName = (job: JobListItem) => `${job.customer.firstName} ${job.customer.lastName}`.trim();
const jobsWord = (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'}`;

export function JobsPage() {
  const { canWrite } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const workflows = useWorkflows();
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const stage = params.get('stage') ?? '';
  // With one route there is nothing to choose, so it is always that one.
  const many = workflows.routes.length > 1;
  const routeId = many ? (params.get('route') ?? '') : (workflows.routes[0]?.id ?? '');
  const route = routeId ? workflows.routes.find((r) => r.id === routeId) : undefined;
  // How many jobs show. Changing a filter, or arriving with a different one, starts again from the first page.
  const filterKey = `${search}|${status}|${stage}|${routeId}`;
  const [paging, setPaging] = useState({ key: filterKey, count: PAGE });
  const shown = paging.key === filterKey ? paging.count : PAGE;
  const loadMore = () => setPaging({ key: filterKey, count: shown + PAGE });

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['jobs', search, status],
    queryFn: () => {
      const query = new URLSearchParams();
      if (search) query.set('search', search);
      if (status) query.set('status', status);
      const qs = query.toString();
      return api<JobListItem[]>(`/import-jobs${qs ? `?${qs}` : ''}`);
    },
  });

  const routeOf = (job: JobListItem) => job.routeId ?? workflows.routeOf(null)?.id ?? null;
  const everywhere = useMemo(() => data ?? [], [data]);
  const all = routeId ? everywhere.filter((job) => routeOf(job) === routeId) : everywhere;
  const stageOf = (job: JobListItem) => (job.status === 'COMPLETED' ? 'completed' : (workflows.stageOf(routeOf(job), job.status)?.id ?? ''));
  const stageCount = (id: string) => all.filter((job) => stageOf(job) === id).length;
  const routeCount = (id: string) => everywhere.filter((job) => routeOf(job) === id).length;
  const jobs = stage && !status ? all.filter((job) => stageOf(job) === stage) : all;
  const visible = jobs.slice(0, shown);

  // The chosen route's statuses, or every route's, each named once.
  const seen = new Map<string, string>();
  for (const r of route ? [route] : workflows.routes) for (const code of routeStatusCodes(r)) if (!seen.has(code)) seen.set(code, workflows.label(r.id, code));
  const statusOptions = [...[...seen].map(([value, label]) => ({ value, label })), ...CLOSING];

  function setParam(name: 'route' | 'stage' | 'status' | 'search', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    // A stage and a status narrow the same thing, so choosing one clears the other.
    if (name === 'stage') next.delete('status');
    if (name === 'status') next.delete('stage');
    // Stages belong to a route, so a new route starts from all of its stages.
    if (name === 'route') next.delete('stage');
    setPaging({ key: '', count: PAGE });
    setParams(next, { replace: true });
  }

  const total = all.length;
  const filtered = Boolean(stage || status || search || (many && routeId));

  return (
    <div className="jobs">
      <PhoneHeader>
        <div className="jobs-phone-head">
          <div>
            <Heading level={1} size="3xl">
              Jobs
            </Heading>
            <Text size="sm">{jobsWord(total)}</Text>
          </div>
          {canWrite ? <Button icon="plus" label="New job" href="/jobs/new" /> : null}
        </div>
      </PhoneHeader>

      <div className="jobs-heading">
        <div>
          <Heading level={1} size="4xl" className="jobs-title">
            Jobs
          </Heading>
          <Text tone="muted">
            {many
              ? 'Every import job in this workspace, on all routes. Pick one route to filter by its stages.'
              : 'Every import job in this workspace. Select a row to open it.'}
          </Text>
        </div>
        {many ? (
          <Select
            className="jobs-status"
            label="Route"
            hideLabel
            options={[{ value: '', label: 'All routes' }, ...workflows.routes.map((r) => ({ value: r.id, label: r.name }))]}
            value={routeId}
            onChange={(event) => setParam('route', event.detail.value)}
          />
        ) : null}
        <Select
          className="jobs-status"
          label="Status"
          hideLabel
          placeholder="All statuses"
          options={statusOptions}
          value={status}
          onChange={(event) => setParam('status', event.detail.value)}
        />
      </div>

      <div className="jobs-phone-search" role="search">
        <TextInput
          type="search"
          label="Search jobs"
          hideLabel
          placeholder="Reference, customer or plate"
          value={search}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setParam('search', (event.currentTarget as HTMLElement & { value: string }).value.trim());
          }}
        />
      </div>

      {many && !routeId ? (
        <div className="jobs-filters" role="group" aria-label="Filter jobs by route">
          <FilterChip
            label="All routes"
            count={status ? undefined : everywhere.length}
            countLabel={jobsWord(everywhere.length)}
            pressed
            onChange={(event) => ((event.currentTarget as HTMLElement & { pressed: boolean }).pressed = true)}
          />
          {workflows.routes.map((r) => {
            const count = routeCount(r.id);
            return (
              <FilterChip
                key={r.id}
                label={r.name}
                count={status ? undefined : count}
                countLabel={jobsWord(count)}
                pressed={false}
                onChange={() => setParam('route', r.id)}
              />
            );
          })}
        </div>
      ) : (
        <div className="jobs-filters" role="group" aria-label={route ? `Filter ${route.name} jobs by stage` : 'Filter jobs by stage'}>
          <FilterChip
            label={many ? 'All stages' : 'All'}
            count={status ? undefined : total}
            countLabel={jobsWord(total)}
            pressed={!stage && !status}
            onChange={(event) => {
              (event.currentTarget as HTMLElement & { pressed: boolean }).pressed = true;
              setParam('stage', '');
            }}
          />
          {[...(route?.stages ?? []).map((s) => ({ id: s.id, name: s.name })), { id: 'completed', name: TERMINAL_LABELS.COMPLETED }].map((item) => {
            const count = stageCount(item.id);
            return (
              <FilterChip
                key={item.id}
                label={item.name}
                count={status ? undefined : count}
                countLabel={jobsWord(count)}
                pressed={stage === item.id && !status}
                onChange={(event) => {
                  (event.currentTarget as HTMLElement & { pressed: boolean }).pressed = true;
                  setParam('stage', item.id);
                }}
              />
            );
          })}
        </div>
      )}

      {search ? (
        <div className="jobs-searching">
          <Text size="sm">{`Showing jobs that match “${search}”`}</Text>
          <Button variant="ghost" size="sm" iconBefore="close" onClick={() => setParam('search', '')}>
            Clear search
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <LoadingScreen label="Loading jobs…" />
      ) : isError ? (
        <Alert tone="danger" heading="Jobs could not load">
          Check your connection, then try again.
          <div className="jobs-retry">
            <Button variant="secondary" busy={isFetching} busyLabel="Trying again" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : jobs.length === 0 ? (
        <EmptyState
          heading={filtered ? 'No jobs match' : 'No jobs yet'}
          lead={
            filtered
              ? 'Try another route, stage or status, or clear the search.'
              : canWrite
                ? 'Create a job to follow a vehicle from collection to delivery.'
                : 'There are no import jobs in this workspace yet.'
          }
          framed
        >
          {canWrite && !filtered ? (
            <Button slot="actions" href="/jobs/new" iconBefore="plus">
              New job
            </Button>
          ) : null}
          {filtered ? (
            <Button slot="actions" variant="secondary" href="/jobs">
              Show all jobs
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <Card className="jobs-table-card" padding="sm">
            <Table
              className="jobs-table"
              caption="Import jobs"
              columns={COLUMNS}
              rows={visible.map((job) => ({
                id: job.id,
                reference: job.reference,
                vehicle: vehicleName(job),
                plate: job.vehicle.ukRegistration ?? '—',
                customer: customerName(job),
                corridor: job.route?.shortLabel ?? `${job.originCountry} → ${job.destinationCountry}`,
                status: workflows.label(routeOf(job), job.status),
                expected: job.expectedDeliveryDate ? formatDate(job.expectedDeliveryDate) : '—',
              }))}
              onClick={(event) => openRowLink(event, navigate)}
            >
              {visible.flatMap((job) => [
                <a key={`${job.id}-ref`} slot={`cell:${job.id}:reference`} href={`/jobs/${job.id}`} className="jobs-ref">
                  {job.reference}
                </a>,
                job.vehicle.ukRegistration ? (
                  <Chip key={`${job.id}-plate`} slot={`cell:${job.id}:plate`} label={job.vehicle.ukRegistration} look="outlined" />
                ) : null,
                <Badge key={`${job.id}-status`} slot={`cell:${job.id}:status`}>
                  {workflows.label(routeOf(job), job.status)}
                </Badge>,
              ])}
            </Table>
            <div className="jobs-foot">
              <Text size="sm" tone="muted">{`Showing ${visible.length} of ${jobsWord(jobs.length)}`}</Text>
              {visible.length < jobs.length ? (
                <Button variant="ghost" size="sm" onClick={loadMore}>
                  Load more
                </Button>
              ) : null}
            </div>
          </Card>

          <ul className="jobs-cards" aria-label="Import jobs">
            {visible.map((job) => {
              const journey = routeProgress(workflows.routeOf(routeOf(job)), job.status);
              const step = journey.steps.findIndex((item) => item.id === journey.current);
              const done = job.status === 'COMPLETED';
              return (
                <li key={job.id}>
                  <a className="jobs-card" href={`/jobs/${job.id}`}>
                    <span className="jobs-card-top">
                      {job.vehicle.ukRegistration ? <span className="jobs-plate">{job.vehicle.ukRegistration}</span> : null}
                      <span className="jobs-card-name">
                        <strong>{vehicleName(job)}</strong>
                        <small>
                          {customerName(job)} · {job.reference}
                        </small>
                      </span>
                    </span>
                    <span className="jobs-bars" aria-hidden="true">
                      {journey.steps.map((item, i) => (
                        <span key={item.id} data-state={done || i < step ? 'done' : i === step ? 'current' : 'todo'} />
                      ))}
                    </span>
                    <span className="jobs-card-foot">
                      <span>{workflows.label(routeOf(job), job.status)}</span>
                      <span>{job.expectedDeliveryDate ? `Expected ${formatDate(job.expectedDeliveryDate)}` : 'No date yet'}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          {visible.length < jobs.length ? (
            <div className="jobs-cards-more">
              <Button variant="secondary" full onClick={loadMore}>
                {`Load more (${visible.length} of ${jobs.length})`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
