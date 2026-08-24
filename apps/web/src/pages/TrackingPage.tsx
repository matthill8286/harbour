import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { LiveTracking } from '../lib/tracking';
import { JourneyMap } from '../components/JourneyMap';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, LoadingScreen, PageHeader } from '../components/ui';

export function TrackingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['tracking-live'],
    queryFn: () => api<LiveTracking>('/tracking/live'),
    refetchInterval: 5000,
  });
  const vehicles = data?.vehicles ?? [];
  const markers = vehicles
    .filter((item) => item.current)
    .map((item) => ({
      id: item.importJobId,
      latitude: item.current!.latitude,
      longitude: item.current!.longitude,
      heading: item.current!.heading,
      label: `${item.vehicle.make ?? 'Vehicle'} ${item.vehicle.model ?? ''}`.trim(),
      sublabel: `${item.reference} · ${item.customer.firstName} ${item.customer.lastName}`,
      href: `/jobs/${item.importJobId}`,
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Live fleet"
        title="Map"
        description="GPS updates while a tracker is assigned. Register TAT140 IMEIs under Trackers, then assign or replace them on the job. Demo units walk the corridor; live Teltonika units arrive via Flespi."
      />
      {isLoading || !data ? (
        <LoadingScreen label="Loading map…" />
      ) : (
        <JourneyMap
          map={data.map}
          trails={vehicles.map((item) => item.trail)}
          markers={markers}
          heightClassName="harbour-map-lg"
        />
      )}
      {data && vehicles.length === 0 ? (
        <EmptyState
          title="No active vehicles to track"
          description="Assign a tracker on a job to see it here."
        />
      ) : (
        <ul className="grid gap-3">
          {vehicles.map((item) => (
            <li key={item.importJobId} className="rounded-2xl bg-paper p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link to={`/jobs/${item.importJobId}`} className="font-semibold text-harbour">
                    {item.reference}
                  </Link>
                  <p className="text-sm text-ink/70">
                    {item.vehicle.make} {item.vehicle.model} · {item.customer.firstName} {item.customer.lastName}
                  </p>
                  <p className="mt-1 text-xs text-ink/50">
                    {item.current
                      ? `${item.current.latitude.toFixed(4)}, ${item.current.longitude.toFixed(4)} · ${relativeTime(item.current.recordedAt)}`
                      : 'Waiting for first GPS ping'}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <p className="mt-2 text-xs text-ink/50">
                {item.tracker
                  ? `${item.tracker.serialNumber} · battery ${item.tracker.batteryLevel ?? '—'}%`
                  : 'No tracker assigned'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
