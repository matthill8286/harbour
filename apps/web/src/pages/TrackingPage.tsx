import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { spreadOverlappingMarkers, type LiveTracking } from '../lib/tracking';
import { JourneyMap } from '../components/JourneyMap';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, LoadingScreen, OpsToolbar, fieldClass, secondaryBtn } from '../components/ui';

type FleetFilter = 'all' | 'live' | 'no-gps';

export function TrackingPage() {
  const [params] = useSearchParams();
  const initialJob = params.get('job');
  const [selectedId, setSelectedId] = useState<string | null>(initialJob);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FleetFilter>('all');
  const listRef = useRef<HTMLUListElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['tracking-live'],
    queryFn: () => api<LiveTracking>('/tracking/live'),
    refetchInterval: 5000,
  });
  const vehicles = data?.vehicles ?? [];
  const pinging = vehicles.filter((item) => item.current).length;
  const awaiting = vehicles.length - pinging;
  const markers = useMemo(
    () =>
      spreadOverlappingMarkers(
        vehicles.flatMap((item) => {
          if (!item.current) return [];
          return [
            {
              id: item.importJobId,
              latitude: item.current.latitude,
              longitude: item.current.longitude,
              heading: item.current.heading ?? null,
              label: `${item.vehicle.make ?? 'Vehicle'} ${item.vehicle.model ?? ''}`.trim(),
              sublabel: `${item.reference} · ${item.customer.firstName} ${item.customer.lastName}`,
              href: `/jobs/${item.importJobId}`,
            },
          ];
        }),
      ),
    [vehicles],
  );
  const markerById = useMemo(
    () => new Map(markers.map((marker) => [marker.id, marker])),
    [markers],
  );
  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vehicles.filter((item) => {
      if (filter === 'live' && !item.current) return false;
      if (filter === 'no-gps' && item.current) return false;
      if (!query) return true;
      const haystack = [
        item.reference,
        item.vehicle.make,
        item.vehicle.model,
        item.customer.firstName,
        item.customer.lastName,
        item.tracker?.serialNumber,
        item.routeTemplate?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, search, vehicles]);
  const selectedVehicle = vehicles.find((item) => item.importJobId === selectedId) ?? null;
  const selectedMarker = selectedId ? markerById.get(selectedId) : null;
  const focusTarget = selectedMarker
    ? { latitude: selectedMarker.latitude, longitude: selectedMarker.longitude }
    : selectedVehicle?.plannedRoute?.[0]
      ? {
          latitude: selectedVehicle.plannedRoute[0].latitude,
          longitude: selectedVehicle.plannedRoute[0].longitude,
        }
      : null;
  const plannedRoutes = useMemo(() => {
    if (selectedId) {
      const selected = vehicles.find((item) => item.importJobId === selectedId);
      return selected?.plannedRoute?.length ? [selected.plannedRoute] : [];
    }
    return vehicles.map((item) => item.plannedRoute).filter((line) => line.length > 1);
  }, [selectedId, vehicles]);

  useEffect(() => {
    if (initialJob) setSelectedId(initialJob);
  }, [initialJob]);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-job-id="${selectedId}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  function selectVehicle(id: string) {
    setSelectedId((current) => (current === id ? null : id));
  }

  return (
    <div className="fleet-ops-page">
      <OpsToolbar
        title="Live fleet"
        meta={
          vehicles.length === 0
            ? 'No active vehicles yet'
            : `${vehicles.length} active · ${pinging} live · ${awaiting} awaiting GPS`
        }
        actions={
          selectedId ? (
            <button type="button" className={secondaryBtn} onClick={() => setSelectedId(null)}>
              Show all
            </button>
          ) : null
        }
      />
      {isLoading || !data ? (
        <LoadingScreen label="Loading fleet map…" />
      ) : vehicles.length === 0 ? (
        <EmptyState
          title="No active vehicles to track"
          description="Assign a tracker on a job to see it here."
        />
      ) : (
        <div className="fleet-map-layout">
          <aside className="fleet-sidebar rounded-2xl bg-paper p-3">
            <div className="space-y-2">
              <label className="block">
                <span className="sr-only">Search fleet</span>
                <input
                  className={fieldClass}
                  placeholder="Search reference, vehicle, customer…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', `All (${vehicles.length})`],
                    ['live', `Live (${pinging})`],
                    ['no-gps', `No GPS (${awaiting})`],
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
            <ul ref={listRef} className="fleet-sidebar-list mt-3 space-y-1.5">
              {filteredVehicles.length === 0 ? (
                <li className="rounded-xl border border-dashed border-ink/15 px-3 py-6 text-center text-sm text-ink/55">
                  No vehicles match.
                </li>
              ) : (
                filteredVehicles.map((item) => {
                  const isSelected = selectedId === item.importJobId;
                  const isLive = Boolean(item.current);
                  return (
                    <li key={item.importJobId}>
                      <button
                        type="button"
                        data-job-id={item.importJobId}
                        className={`fleet-sidebar-item w-full rounded-xl border px-3 py-2.5 text-left transition${
                          isSelected
                            ? ' is-selected'
                            : ' border-ink/10 hover:border-harbour/35 hover:bg-sand/40'
                        }`}
                        onClick={() => selectVehicle(item.importJobId)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate text-sm font-semibold">
                              <span
                                className={`fleet-ping-dot${isLive ? ' is-live' : ' is-estimated'}`}
                                aria-hidden
                              />
                              {item.reference}
                            </p>
                            <p className="truncate text-xs text-ink/70">
                              {item.vehicle.make} {item.vehicle.model}
                            </p>
                            <p className="truncate text-[11px] text-ink/50">
                              {item.customer.firstName} {item.customer.lastName}
                            </p>
                          </div>
                          <StatusBadge status={item.status} />
                        </div>
                        <p className="mt-1.5 text-[11px] text-ink/50">
                          {isLive
                            ? `${item.current!.latitude.toFixed(4)}, ${item.current!.longitude.toFixed(4)} · ${relativeTime(item.current!.recordedAt)}`
                            : item.routeTemplate
                              ? `Awaiting GPS · ${item.routeTemplate.name}`
                              : 'Awaiting GPS · no route assigned'}
                        </p>
                        {isSelected ? (
                          <Link
                            to={`/jobs/${item.importJobId}?tab=tracking`}
                            className="mt-1.5 inline-block text-xs font-semibold text-harbour"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Open job
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
            {selectedVehicle ? (
              <div className="fleet-map-focus-bar mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sand/70 px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold">{selectedVehicle.reference}</p>
                  <p className="text-xs text-ink/55">
                    {selectedVehicle.vehicle.make} {selectedVehicle.vehicle.model} ·{' '}
                    {selectedVehicle.customer.firstName} {selectedVehicle.customer.lastName}
                    {selectedVehicle.routeTemplate
                      ? ` · ${selectedVehicle.routeTemplate.name}`
                      : ''}
                  </p>
                </div>
                <StatusBadge status={selectedVehicle.status} />
              </div>
            ) : (
              <p className="fleet-map-hint mb-2 rounded-xl border border-dashed border-ink/15 px-3 py-2 text-xs text-ink/55">
                Select a vehicle in the list, or tap a marker, to focus its planned route.
              </p>
            )}
            <JourneyMap
              map={data.map}
              trailLines={vehicles.map((item) => ({
                id: item.importJobId,
                points: item.trail,
              }))}
              markers={markers}
              plannedRoutes={plannedRoutes}
              heightClassName="harbour-map-fleet"
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
