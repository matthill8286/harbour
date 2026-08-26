import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DEFAULT_WORKFLOW_STATUSES,
  JOB_STAGE_LABELS,
  JOB_STAGES,
  getJobStage,
  type JobStage,
  type JobStatus,
} from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import {
  EmptyState,
  LoadingScreen,
  OpsToolbar,
  StaffPage,
  fieldClass,
  primaryBtn,
} from '../components/ui';
import { useSession } from '../lib/session';

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

export function JobsPage() {
  const { canWrite } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const status = params.get('status') ?? '';
  const stage = (params.get('stage') ?? '') as JobStage | '';

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', debouncedSearch, status],
    queryFn: () => {
      const query = new URLSearchParams();
      if (debouncedSearch) query.set('search', debouncedSearch);
      if (status) query.set('status', status);
      const qs = query.toString();
      return api<JobListItem[]>(`/import-jobs${qs ? `?${qs}` : ''}`);
    },
  });

  const jobs = useMemo(() => {
    const list = data ?? [];
    if (!stage || status) return list;
    return list.filter((job) => getJobStage(job.status) === stage);
  }, [data, stage, status]);

  function setFilter(next: { status?: string; stage?: string }) {
    const nextParams = new URLSearchParams(params);
    if ('status' in next && 'stage' in next && !next.status && !next.stage) {
      nextParams.delete('status');
      nextParams.delete('stage');
      setParams(nextParams, { replace: true });
      return;
    }
    if (next.status !== undefined) {
      if (next.status) nextParams.set('status', next.status);
      else nextParams.delete('status');
      nextParams.delete('stage');
    }
    if (next.stage !== undefined) {
      if (next.stage) nextParams.set('stage', next.stage);
      else nextParams.delete('stage');
      nextParams.delete('status');
    }
    setParams(nextParams, { replace: true });
  }

  const stageChips = JOB_STAGES.filter((item) => item !== 'cancelled');

  return (
    <StaffPage wide>
      <OpsToolbar
        title="Jobs"
        meta={
          stage
            ? `Filtered to ${JOB_STAGE_LABELS[stage]} stage`
            : status
              ? `Filtered to ${DEFAULT_WORKFLOW_STATUSES.find((item) => item.code === status)?.label ?? status}`
              : 'Authoritative list for this workspace'
        }
        actions={
          canWrite ? (
            <Link to="/jobs/new" className={primaryBtn}>
              New job
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={fieldClass}
            placeholder="Search reference, customer, plate"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className={`${fieldClass} sm:w-56`}
            value={status}
            onChange={(event) => setFilter({ status: event.target.value })}
          >
            <option value="">All statuses</option>
            {DEFAULT_WORKFLOW_STATUSES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`fleet-filter-chip${!stage && !status ? ' is-active' : ''}`}
            onClick={() => setFilter({ stage: '', status: '' })}
          >
            All
          </button>
          {stageChips.map((item) => (
            <button
              key={item}
              type="button"
              className={`fleet-filter-chip${stage === item ? ' is-active' : ''}`}
              onClick={() => setFilter({ stage: item })}
            >
              {JOB_STAGE_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="jobs-table-wrap">
        {isLoading ? (
          <LoadingScreen label="Loading jobs…" />
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No jobs match"
            description={canWrite ? 'Try a different filter, or create a new import job.' : 'Try a different filter.'}
            action={
              canWrite ? (
                <Link to="/jobs/new" className={primaryBtn}>
                  New job
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <table className="jobs-table hidden md:table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Vehicle</th>
                  <th>Plate</th>
                  <th>Customer</th>
                  <th>Corridor</th>
                  <th>Status</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    tabIndex={0}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/jobs/${job.id}`);
                      }
                    }}
                  >
                    <td className="font-semibold">{job.reference}</td>
                    <td>
                      {job.vehicle.make} {job.vehicle.model}
                    </td>
                    <td>{job.vehicle.ukRegistration ?? '—'}</td>
                    <td>
                      {job.customer.firstName} {job.customer.lastName}
                    </td>
                    <td className="text-ink/60">
                      {job.originCountry} → {job.destinationCountry}
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="text-ink/55">
                      {job.expectedDeliveryDate ? formatDate(job.expectedDeliveryDate) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-ink/10 md:hidden">
              {jobs.map((job) => (
                <li key={job.id}>
                  <Link to={`/jobs/${job.id}`} className="block px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{job.reference}</p>
                        <p className="truncate text-sm text-ink/70">
                          {job.vehicle.make} {job.vehicle.model} · {job.vehicle.ukRegistration ?? 'No plate'}
                        </p>
                        <p className="truncate text-xs text-ink/50">
                          {job.customer.firstName} {job.customer.lastName} · {job.originCountry} →{' '}
                          {job.destinationCountry}
                        </p>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </StaffPage>
  );
}
