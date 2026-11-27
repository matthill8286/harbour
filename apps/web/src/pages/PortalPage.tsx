import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { isDestinationReached, type JobStatus } from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { JourneyStepper } from '../components/JourneyStepper';
import { EmptyState, LoadingScreen, PageHeader } from '../components/ui';
import { useSession } from '../lib/session';

type PortalJob = {
  id: string;
  reference: string;
  status: JobStatus;
  expectedDeliveryDate: string | null;
  photoCount: number;
  documentCount: number;
  vehicle: {
    make: string | null;
    model: string | null;
    variant: string | null;
    ukRegistration: string | null;
    colour: string | null;
    year: number | null;
  };
};

export function PortalPage() {
  const { workspace } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-jobs'],
    queryFn: () => api<PortalJob[]>('/portal/jobs'),
  });

  if (isLoading) return <LoadingScreen label="Loading your vehicle…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={workspace}
        title="Your vehicles"
        description={`Follow the import ${workspace} opened for you. Photos and documents appear when they are shared.`}
      />
      {(data ?? []).length === 0 ? (
        <EmptyState title="No import in progress" description="When a job is opened for you, it will appear here." />
      ) : (
        (data ?? []).map((job) => (
          <Link
            key={job.id}
            to={`/portal/${job.id}`}
            className="block rounded-2xl bg-paper p-5 transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgb(11_31_51_/_0.08)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {job.vehicle.make} {job.vehicle.model}
                </p>
                <p className="text-sm text-ink/60">
                  {job.vehicle.ukRegistration}
                  {job.expectedDeliveryDate && !isDestinationReached(job.status) ? ` · expected ${formatDate(job.expectedDeliveryDate)}` : ''}
                </p>
                <p className="mt-1 text-xs text-ink/45">
                  {job.photoCount} {job.photoCount === 1 ? 'photo' : 'photos'} · {job.documentCount} {job.documentCount === 1 ? 'document' : 'documents'}
                </p>
              </div>
              <StatusBadge status={job.status} />
            </div>
            <div className="mt-4">
              <JourneyStepper status={job.status} variant="customer" embedded />
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
