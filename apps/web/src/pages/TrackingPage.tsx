import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { corridorPositionForStatus } from '@vip/shared';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { spreadOverlappingMarkers, type LiveTracking } from '../lib/tracking';
import { JourneyMap } from '../components/JourneyMap';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, fieldClass, LoadingScreen, PageHeader, secondaryBtn } from '../components/ui';

type FleetFilter = 'all' | 'live' | 'estimated';

export function TrackingPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FleetFilter>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['tracking-live'],
    queryFn: () => api<LiveTracking>('/tracking/live'),
    refetchInterval: 5000,
  });
  const vehicles = data?.vehicles ?? [];
  const pinging = vehicles.filter((item) => item.current).length;
  const markers = spreadOverlappingMarkers(
    vehicles.map((item) => {
      const point = item.current ?? corridorPositionForStatus(item.status);
      return {
        id: item.importJobId,
        latitude: point.latitude,
        longitude: point.longitude,
        heading: item.current?.heading ?? null,
        estimated: !item.current,
        status: item.status,
        label: `${item.vehicle.make ?? 'Vehicle'} ${item.vehicle.model ?? ''}`.trim(),
        sublabel: `${item.reference} · ${item.customer.firstName} ${item.customer.lastName}`,
        href: `/jobs/${item.importJobId}`,
      };
    }),
  );
  const markerById = useMemo(
    () => new Map(markers.map((marker) => [marker.id, marker])),
    [markers],
  );
  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vehicles.filter((item) => {
      if (filter === 'live' && !item.current) return false;
      if (filter === 'estimated' && item.current) return false;
      if (!query) return true;
      const haystack = [
        item.reference,
        item.vehicle.make,
        item.vehicle.model,
        item.customer.firstName,
        item.customer.lastName,
        item.tracker?.serialNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, search, vehicles]);
  const selectedMarker = selectedId ? markerById.get(selectedId) : null;
  const focusTarget = selectedMarker
    ? { latitude: selectedMarker.latitude, longitude: selectedMarker.longitude }
    : null;

  function selectVehicle(id: string) {
    setSelectedId((current) => (current === id ? null : id));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Live fleet"
        title="Map"
        description={
          vehicles.length === 0
            ? 'Vehicles currently moving for this organisation. Trails stay inside this workspace.'
            : `${vehicles.length} active ${vehicles.length === 1 ? 'job' : 'jobs'} · ${pinging} with a live ping. Select a vehicle in the list to jump to it on the map.`
        }
        actions={
          selectedId ? (
            <button type="button" className={secondaryBtn} onClick={() => setSelectedId(null)}>
              Show all fleet
            </button>
          ) : null
        }
      />
      {isLoading || !data ? (
        <LoadingScreen label="Loading map…" />
      ) : vehicles.length === 0 ? (
        <EmptyState
          title="No active vehicles to track"
          description="Assign a tracker on a job to see it here."
        />
      ) : (
        <div className="fleet-map-layout">
          <aside className="fleet-sidebar rounded-2xl bg-paper p-4">
            <div className="space-y-3">
              <label className="block">
                <span className="sr-only">Search fleet</span>
                <input
                  className={fieldClass}
                  placeholder="Search reference, vehicle, customer…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['all', `All (${vehicles.length})`],
                    ['live', `Live ping (${pinging})`],
                    ['estimated', `Estimated (${vehicles.length - pinging})`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`fleet-filter-chip${filter === value ? ' is-active' : ''}`}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="fleet-sidebar-list mt-4 space-y-2">
              {filteredVehicles.length === 0 ? (
                <li className="rounded-xl border border-dashed border-ink/15 px-3 py-6 text-center text-sm text-ink/55">
                  No vehicles match your search.
                </li>
              ) : (
                filteredVehicles.map((item) => {
                  const isSelected = selectedId === item.importJobId;
                  const point = item.current ?? corridorPositionForStatus(item.status);
                  return (
                    <li key={item.importJobId}>
                      <button
                        type="button"
                        className={`fleet-sidebar-item w-full rounded-xl border px-3 py-3 text-left transition${
                          isSelected ? ' is-selected' : ' border-ink/10 hover:border-harbour/35 hover:bg-sand/40'
                        }`}
                        onClick={() => selectVehicle(item.importJobId)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{item.reference}</p>
                            <p className="truncate text-sm text-ink/70">
                              {item.vehicle.make} {item.vehicle.model}
                            </p>
                            <p className="truncate text-xs text-ink/50">
                              {item.customer.firstName} {item.customer.lastName}
                            </p>
                          </div>
                          <StatusBadge status={item.status} />
                        </div>
                        <p className="mt-2 text-xs text-ink/50">
                          {item.current
                            ? `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)} · ${relativeTime(item.current.recordedAt)}`
                            : 'No ping yet · corridor estimate'}
                        </p>
                        {isSelected ? (
                          <Link
                            to={`/jobs/${item.importJobId}`}
                            className="mt-2 inline-block text-xs font-semibold text-harbour"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Open job details
                          </Link>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </aside>
          <div className="fleet-map-panel rounded-2xl bg-paper p-2">
            <JourneyMap
              map={data.map}
              trails={vehicles.map((item) => item.trail)}
              markers={markers}
              heightClassName="harbour-map-fleet"
              showCorridor={!selectedId}
              showPlannedRoute
              fitMode="frame"
              labelled
              selectedId={selectedId}
              focusTarget={focusTarget}
              onMarkerSelect={selectVehicle}
            />
          </div>
        </div>
      )}
    </div>
  );
}
