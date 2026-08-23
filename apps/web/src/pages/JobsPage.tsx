import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { DEFAULT_WORKFLOW_STATUSES, type JobStatus } from '@vip/shared';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, LoadingScreen, PageHeader, fieldClass, primaryBtn } from '../components/ui';

type JobListItem = {
  id: string;
  reference: string;
  status: JobStatus;
  originCountry: string;
  destinationCountry: string;
  customer: { firstName: string; lastName: string };
  vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
};

export function JobsPage() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState('');
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

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Work"
        title="Import jobs"
        actions={
          <Link to="/jobs/new" className={primaryBtn}>
            New job
          </Link>
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={fieldClass}
          placeholder="Search reference, customer, plate"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className={`${fieldClass} sm:w-64`} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {DEFAULT_WORKFLOW_STATUSES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? <LoadingScreen label="Loading jobs…" /> : null}
      {!isLoading && (data ?? []).length === 0 ? (
        <EmptyState
          title="No jobs match"
          description="Try a different search, or create a new import job."
          action={
            <Link to="/jobs/new" className={primaryBtn}>
              New job
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {(data ?? []).map((job) => (
            <li key={job.id}>
              <Link
                to={`/jobs/${job.id}`}
                className="block rounded-2xl bg-paper p-4 transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgb(11_31_51_/_0.08)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{job.reference}</p>
                    <p className="text-sm text-ink/70">
                      {job.vehicle.make} {job.vehicle.model} · {job.vehicle.ukRegistration ?? 'No UK plate'}
                    </p>
                    <p className="text-sm text-ink/50">
                      {job.customer.firstName} {job.customer.lastName} · {job.originCountry} → {job.destinationCountry}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
