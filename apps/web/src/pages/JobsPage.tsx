import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  FilterChip,
  Heading,
  Select,
  Table,
  Text,
  TextInput,
} from '@atomic-ui/ui-react';
import {
  DEFAULT_WORKFLOW_STATUSES,
  JOB_STAGE_LABELS,
  JOB_STAGES,
  getJobStage,
  getStatusLabel,
  type JobStage,
  type JobStatus,
} from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { openRowLink } from '../lib/tableRows';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import './JobsPage.css';

type JobListItem = {
  id: string;
  reference: string;
  status: JobStatus;
  originCountry: string;
  destinationCountry: string;
  expectedDeliveryDate: string | null;
  customer: { firstName: string; lastName: string };
  vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
};

/** How many jobs show before Load more. */
const PAGE = 25;

/** The stages a job can be filtered to; a cancelled job is reached through the status filter. */
const STAGE_FILTERS = JOB_STAGES.filter((stage) => stage !== 'cancelled');

/** The stages on the way, for the journey bars on a phone. */
const JOURNEY: JobStage[] = JOB_STAGES.filter((stage) => stage !== 'completed' && stage !== 'cancelled');

const COLUMNS = [
  { key: 'reference', label: 'Reference' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'plate', label: 'Plate' },
  { key: 'customer', label: 'Customer' },
  { key: 'corridor', label: 'Corridor' },
  { key: 'status', label: 'Status' },
  { key: 'expected', label: 'Expected' },
];

const STATUS_OPTIONS = DEFAULT_WORKFLOW_STATUSES.map((item) => ({ value: item.code, label: item.label }));

const vehicleName = (job: JobListItem) => [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
const customerName = (job: JobListItem) => `${job.customer.firstName} ${job.customer.lastName}`.trim();
const jobsWord = (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'}`;

export function JobsPage() {
  const { canWrite } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const stage = (params.get('stage') ?? '') as JobStage | '';
  // How many jobs show. Changing a filter, or arriving with a different one, starts again from the first page.
  const filterKey = `${search}|${status}|${stage}`;
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

  const all = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => {
    const byStage = new Map<JobStage, number>();
    for (const job of all) {
      const at = getJobStage(job.status);
      byStage.set(at, (byStage.get(at) ?? 0) + 1);
    }
    return byStage;
  }, [all]);
  const jobs = useMemo(() => (stage && !status ? all.filter((job) => getJobStage(job.status) === stage) : all), [all, stage, status]);
  const visible = jobs.slice(0, shown);

  function setParam(name: 'stage' | 'status' | 'search', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    // A stage and a status narrow the same thing, so choosing one clears the other.
    if (name === 'stage') next.delete('status');
    if (name === 'status') next.delete('stage');
    setPaging({ key: '', count: PAGE });
    setParams(next, { replace: true });
  }

  const total = all.length;
  const filtered = Boolean(stage || status || search);

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
          <Text tone="muted">Every import job in this workspace. Select a row to open it.</Text>
        </div>
        <Select
          className="jobs-status"
          label="Status"
          placeholder="All statuses"
          options={STATUS_OPTIONS}
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

      <div className="jobs-filters" role="group" aria-label="Filter jobs by stage">
        <FilterChip
          label="All"
          count={status ? undefined : total}
          countLabel={jobsWord(total)}
          pressed={!stage && !status}
          onChange={(event) => {
            (event.currentTarget as HTMLElement & { pressed: boolean }).pressed = true;
            setParam('stage', '');
          }}
        />
        {STAGE_FILTERS.map((item) => {
          const count = counts.get(item) ?? 0;
          return (
            <FilterChip
              key={item}
              label={JOB_STAGE_LABELS[item]}
              count={status ? undefined : count}
              countLabel={jobsWord(count)}
              pressed={stage === item && !status}
              onChange={(event) => {
                (event.currentTarget as HTMLElement & { pressed: boolean }).pressed = true;
                setParam('stage', item);
              }}
            />
          );
        })}
      </div>

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
              ? 'Try another stage or status, or clear the search.'
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
                corridor: `${job.originCountry} → ${job.destinationCountry}`,
                status: getStatusLabel(job.status),
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
                  {getStatusLabel(job.status)}
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
              const at = getJobStage(job.status);
              const step = JOURNEY.indexOf(at);
              const done = at === 'completed';
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
                      {JOURNEY.map((item, i) => (
                        <span key={item} data-state={done || i < step ? 'done' : i === step ? 'current' : 'todo'} />
                      ))}
                    </span>
                    <span className="jobs-card-foot">
                      <span>{getStatusLabel(job.status)}</span>
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
