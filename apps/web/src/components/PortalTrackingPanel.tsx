import { useQuery } from '@tanstack/react-query';
import { getStatusLabel, isDestinationReached, type JobStatus } from '@vip/shared';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { JobTracking } from '../lib/tracking';
import { JourneyMap } from './JourneyMap';

export function PortalTrackingPanel({
  jobId,
  destination,
}: {
  jobId: string;
  destination?: string;
}) {
  const { data: tracking } = useQuery({
    queryKey: ['portal-tracking', jobId],
    queryFn: () => api<JobTracking>(`/portal/jobs/${jobId}/tracking`),
    enabled: Boolean(jobId),
    refetchInterval: 8000,
  });

  if (!tracking) {
    return <section className="rounded-2xl bg-paper p-4 text-sm text-ink/50">Loading location…</section>;
  }

  const current = tracking.current;
  const arrived = isDestinationReached(tracking.status as JobStatus);
  const markers = current
    ? [
        {
          id: tracking.importJobId,
          latitude: current.latitude,
          longitude: current.longitude,
          heading: current.heading,
          status: tracking.status as JobStatus,
          label: `${tracking.vehicle.make ?? 'Your vehicle'} ${tracking.vehicle.model ?? ''}`.trim(),
          sublabel: getStatusLabel(tracking.status as JobStatus),
        },
      ]
    : [];

  return (
    <section className="space-y-3 rounded-2xl bg-paper p-4">
      <div>
        <h2 className="display text-2xl">Where it is</h2>
        <p className="text-sm text-ink/60">
          {arrived
            ? `Arrived${destination ? ` in ${destination}` : ''} · updated ${current ? formatDateTime(current.recordedAt) : 'just now'}`
            : current
              ? `Last update ${formatDateTime(current.recordedAt)}`
              : 'Location will appear once the vehicle is on the road.'}
        </p>
      </div>
      <JourneyMap
        map={tracking.map}
        trail={tracking.trail}
        markers={markers}
        showPlannedRoute={!arrived}
      />
    </section>
  );
}
