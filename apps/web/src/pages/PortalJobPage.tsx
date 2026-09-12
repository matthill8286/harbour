import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getStatusLabel, isDestinationReached, type JobStatus } from '@vip/shared';
import { api, ApiError } from '../lib/api';
import { formatCategory, formatDate, formatDateTime } from '../lib/format';
import { PortalFiles } from '../components/PortalFiles';
import { JourneyStepper } from '../components/JourneyStepper';
import { StatusBadge } from '../components/StatusBadge';
import { Card, ErrorBanner, LoadingScreen } from '../components/ui';

type PortalJob = {
  id: string;
  reference: string;
  status: JobStatus;
  originCountry: string;
  destinationCountry: string;
  expectedDeliveryDate: string | null;
  vehicle: {
    make: string | null;
    model: string | null;
    variant: string | null;
    ukRegistration: string | null;
    colour: string | null;
    year: number | null;
  };
  notes: { id: string; body: string; createdAt: string }[];
  documents: {
    id: string;
    name: string;
    type: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
  photos: { id: string; filename: string; category: string; mimeType: string; createdAt: string }[];
  journeys: { id: string; type: string; origin: string; destination: string; status: string }[];
  statusHistory: { id: string; toStatus: string; note: string | null; createdAt: string }[];
};

export function PortalJobPage() {
  const { id = '' } = useParams();
  const { data: job, isLoading, isError, error } = useQuery({
    queryKey: ['portal-job', id],
    queryFn: () => api<PortalJob>(`/portal/jobs/${id}`),
    enabled: Boolean(id),
  });
  if (isLoading) return <LoadingScreen label="Loading your vehicle…" />;
  if (isError || !job) {
    return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load this job.'} />;
  }

  const vehicleLine = [job.vehicle.year, job.vehicle.colour, job.vehicle.variant].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <Link to="/portal" className="text-sm font-semibold text-harbour">
        ← Your vehicles
      </Link>
      <div className="rounded-3xl bg-ink p-5 text-paper">
        <p className="text-xs uppercase tracking-[0.2em] text-mist">{job.reference}</p>
        <h1 className="display text-4xl">
          {job.vehicle.make} {job.vehicle.model}
        </h1>
        <p className="text-mist">
          {job.vehicle.ukRegistration}
          {vehicleLine ? ` · ${vehicleLine}` : ''}
        </p>
        <p className="mt-1 text-sm text-mist">
          {job.originCountry} → {job.destinationCountry}
          {job.expectedDeliveryDate && !isDestinationReached(job.status)
            ? ` · expected ${formatDate(job.expectedDeliveryDate)}`
            : null}
        </p>
        <div className="mt-3">
          <StatusBadge status={job.status} inverted />
        </div>
      </div>
      <JourneyStepper status={job.status} variant="customer" />
      <PortalFiles jobId={job.id} photos={job.photos} documents={job.documents} />
      {job.journeys.length > 0 ? (
        <Card>
          <h2 className="display text-2xl">The route</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {job.journeys.map((journey) => (
              <li key={journey.id}>
                <span className="font-semibold">
                  {journey.origin} → {journey.destination}
                </span>
                <span className="text-ink/50"> · {formatCategory(journey.status)}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      <Card>
        <h2 className="display text-2xl">Updates</h2>
        {job.notes.length === 0 && job.statusHistory.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">No updates yet.</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm">
            {job.notes.map((item) => (
              <li key={item.id} className="rounded-xl bg-sand/70 p-3">
                {item.body}
                <p className="mt-1 text-xs text-ink/45">{formatDateTime(item.createdAt)}</p>
              </li>
            ))}
            {job.statusHistory.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 text-ink/70">
                <span>
                  {getStatusLabel(item.toStatus as JobStatus)}
                  {item.note ? ` — ${item.note}` : ''}
                </span>
                <span className="text-xs text-ink/40">{formatDateTime(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
