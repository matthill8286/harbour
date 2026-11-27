import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, EmptyState, FilterChip, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { getStatusLabel } from '@vip/shared';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { hasSignal, nearWaypoint } from '../lib/fleet';
import { spreadOverlappingMarkers, type LiveTracking, type TrackingVehicle } from '../lib/tracking';
import { JourneyMap } from '../components/JourneyMap';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import './fleet/Fleet.css';

type Filter = 'all' | 'live' | 'silent';

const vehicleName = (v: TrackingVehicle) => [v.vehicle.make, v.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
const customerName = (v: TrackingVehicle) => `${v.customer.firstName} ${v.customer.lastName}`.trim();
const vehiclesWord = (n: number) => `${n} ${n === 1 ? 'vehicle' : 'vehicles'}`;

/** One line on where a vehicle is: its stage, the waypoint it is near, how fresh the ping is and its speed. */
function whereabouts(v: TrackingVehicle, live: boolean) {
  if (!v.current) return `${getStatusLabel(v.status)} · no ping yet`;
  const near = nearWaypoint(v.current, v.plannedRoute);
  const ago = relativeTime(v.current.recordedAt);
  if (!live) return `${getStatusLabel(v.status)} · no signal since ${ago}`;
  const speed = v.current.speed != null && v.current.speed >= 1 ? `${Math.round(v.current.speed)} km/h` : null;
  return [near ? `Near ${near}` : getStatusLabel(v.status), ago, speed].filter(Boolean).join(' · ');
}

/**
 * Live fleet, after the Figma frames "Business · Live map": every vehicle with a
 * tracker on the planned corridor, a list to search and filter, and the chosen
 * vehicle's details under the map.
 */
export function TrackingPage() {
  const [params] = useSearchParams();
  const initialJob = params.get('job');
  const [selectedId, setSelectedId] = useState<string | null>(initialJob);
  // A new ?job= link while the page is open selects that vehicle.
  const [linkedJob, setLinkedJob] = useState(initialJob);
  if (initialJob !== linkedJob) {
    setLinkedJob(initialJob);
    if (initialJob) setSelectedId(initialJob);
  }
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ['tracking-live'],
    queryFn: () => api<LiveTracking>('/tracking/live'),
    refetchInterval: 5000,
  });
  const data = query.data;
  // Judge freshness against when the data arrived, so a render alone never changes it.
  const now = query.dataUpdatedAt;

  const vehicles = useMemo(() => (data?.vehicles ?? []).map((v) => ({ v, live: hasSignal(v, now) })), [data, now]);
  const liveCount = vehicles.filter((x) => x.live).length;
  const silentCount = vehicles.length - liveCount;

  const markers = useMemo(
    () =>
      spreadOverlappingMarkers(
        vehicles.flatMap(({ v }) =>
          v.current
            ? [
                {
                  id: v.importJobId,
                  latitude: v.current.latitude,
                  longitude: v.current.longitude,
                  heading: v.current.heading ?? null,
                  label: `${v.reference} · ${vehicleName(v)}`,
                  sublabel: customerName(v),
                  href: `/jobs/${v.importJobId}`,
                },
              ]
            : [],
        ),
      ),
    [vehicles],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter(({ v, live }) => {
      if (filter === 'live' && !live) return false;
      if (filter === 'silent' && live) return false;
      if (!q) return true;
      return [v.reference, v.vehicle.make, v.vehicle.model, v.vehicle.ukRegistration, v.customer.firstName, v.customer.lastName, v.tracker?.serialNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [filter, search, vehicles]);

  const selected = vehicles.find(({ v }) => v.importJobId === selectedId) ?? null;
  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;
  const focusTarget = selectedMarker
    ? { latitude: selectedMarker.latitude, longitude: selectedMarker.longitude }
    : selected?.v.plannedRoute[0]
      ? {
          latitude: selected.v.plannedRoute[0].latitude,
          longitude: selected.v.plannedRoute[0].longitude,
        }
      : null;
  const plannedRoutes = useMemo(() => {
    if (selected) return selected.v.plannedRoute.length > 1 ? [selected.v.plannedRoute] : [];
    return vehicles.map(({ v }) => v.plannedRoute).filter((line) => line.length > 1);
  }, [selected, vehicles]);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-job-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const select = (id: string) => setSelectedId((current) => (current === id ? null : id));
  const chips: Array<[Filter, string, number]> = [
    ['all', 'All', vehicles.length],
    ['live', 'Live', liveCount],
    ['silent', 'No signal', silentCount],
  ];

  return (
    <div className="fleet fleet-live">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          Live fleet
        </Heading>
        <Text size="sm">{data ? `${vehiclesWord(vehicles.length)} with a tracker` : ' '}</Text>
      </PhoneHeader>

      <div className="fleet-heading">
        <Heading level={1} size="4xl">
          Live fleet
        </Heading>
        <Text tone="muted">Every vehicle with an assigned tracker, on the planned corridor.</Text>
      </div>

      {query.isLoading ? (
        <LoadingScreen label="Loading the fleet…" />
      ) : query.isError || !data ? (
        <Alert tone="danger" heading="The fleet could not load">
          Check your connection, then try again.
          <div className="job-retry">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : vehicles.length === 0 ? (
        <EmptyState heading="No active vehicles to track" lead="Assign a tracker on a job to see it here." framed />
      ) : (
        <div className="fleet-layout">
          <Card className="fleet-card fleet-side">
            <div role="search">
              <TextInput
                type="search"
                label="Search the fleet"
                hideLabel
                placeholder="Search reference, vehicle, customer…"
                value={search}
                onChange={(event) => {
                  const value = event.detail.value;
                  setSearch(value);
                }}
              />
            </div>
            <div className="fleet-chips" role="group" aria-label="Filter vehicles">
              {chips.map(([key, label, count]) => (
                <FilterChip
                  key={key}
                  label={label}
                  count={count}
                  countLabel={vehiclesWord(count)}
                  pressed={filter === key}
                  onChange={(event) => {
                    (event.currentTarget as HTMLElement & { pressed: boolean }).pressed = true;
                    setFilter(key);
                  }}
                />
              ))}
            </div>
            <div className="fleet-list" ref={listRef}>
              {shown.length === 0 ? (
                <Text tone="muted">No vehicles match.</Text>
              ) : (
                shown.map(({ v, live }) => (
                  <button
                    key={v.importJobId}
                    type="button"
                    data-job-id={v.importJobId}
                    className={`fleet-vehicle${selectedId === v.importJobId ? ' is-selected' : ''}${live ? '' : ' is-silent'}`}
                    aria-pressed={selectedId === v.importJobId}
                    onClick={() => select(v.importJobId)}
                  >
                    <span className="fleet-vehicle-head">
                      <strong>{v.reference}</strong>
                      <Badge tone={live ? (selectedId === v.importJobId ? 'solid' : 'neutral') : 'danger'}>{live ? 'Live' : 'No signal'}</Badge>
                    </span>
                    <span className="fleet-vehicle-name">{`${vehicleName(v)} · ${customerName(v)}`}</span>
                    <span className="fleet-vehicle-where">{whereabouts(v, live)}</span>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card className="fleet-card fleet-map-card">
            <div className="fleet-map">
              <JourneyMap
                map={data.map}
                trailLines={vehicles.map(({ v }) => ({
                  id: v.importJobId,
                  points: v.trail,
                }))}
                markers={markers}
                plannedRoutes={plannedRoutes}
                heightClassName="fleet-map-canvas"
                fitMode="frame"
                labelled
                selectedId={selectedId}
                focusTarget={focusTarget}
                onMarkerSelect={select}
              />
            </div>
            {selected ? (
              <div className="fleet-focus">
                <div className="fleet-focus-text">
                  <Heading level={2} size="sm">
                    {`${selected.v.reference} · ${vehicleName(selected.v)}`}
                  </Heading>
                  <Text size="sm" tone="muted">
                    {[whereabouts(selected.v, selected.live), selected.v.tracker?.batteryLevel != null ? `battery ${selected.v.tracker.batteryLevel}%` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </div>
                <div className="fleet-focus-actions">
                  <Button variant="secondary" href={`/jobs/${selected.v.importJobId}?tab=tracking`}>
                    Tracking tab
                  </Button>
                  <Button iconAfter="arrow-right" href={`/jobs/${selected.v.importJobId}`}>
                    Open job
                  </Button>
                </div>
              </div>
            ) : (
              <Text size="sm" tone="muted" className="fleet-hint">
                Choose a vehicle in the list, or a marker on the map, to follow its corridor.
              </Text>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
