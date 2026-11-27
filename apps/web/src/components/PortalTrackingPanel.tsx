import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { JobTracking } from '../lib/tracking';
import { JourneyMap } from './JourneyMap';

/** The vehicle on the map. The status label and arrival come from the job's route, as the customer sees it. */
export function PortalTrackingPanel({
  jobId,
  destination,
  statusLabel,
  arrived,
}: {
  jobId: string;
  destination?: string;
  statusLabel: string;
  arrived: boolean;
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
  const plannedRoute = !arrived && tracking.plannedRoute?.length ? tracking.plannedRoute : [];
  const markers = current
    ? [
        {
          id: tracking.importJobId,
          latitude: current.latitude,
          longitude: current.longitude,
          heading: current.heading,
          label: `${tracking.vehicle.make ?? 'Your vehicle'} ${tracking.vehicle.model ?? ''}`.trim(),
          sublabel: statusLabel,
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
              : tracking.routeTemplate
                ? `On the ${tracking.routeTemplate.name} corridor — location appears once the tracker reports.`
                : 'Location will appear once the vehicle is on the road.'}
        </p>
      </div>
      <JourneyMap map={tracking.map} trail={tracking.trail} markers={markers} plannedRoutes={plannedRoute.length > 1 ? [plannedRoute] : []} />
    </section>
  );
}
