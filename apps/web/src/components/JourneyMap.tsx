import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import * as L from 'leaflet';
import {
  remainingCorridorFrom,
  UK_TO_CYPRUS_ROUTE,
  type JobStatus,
  type LocationPoint,
  type MapConfig,
} from '@vip/shared';

type MapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  label: string;
  sublabel?: string;
  href?: string;
  estimated?: boolean;
  status?: JobStatus;
};

type JourneyMapProps = {
  map: MapConfig;
  trail?: LocationPoint[];
  trails?: LocationPoint[][];
  markers: MapMarker[];
  heightClassName?: string;
  showPlannedRoute?: boolean;
  showCorridor?: boolean;
  fitMode?: 'follow' | 'frame' | 'none';
  labelled?: boolean;
  selectedId?: string | null;
  focusTarget?: { latitude: number; longitude: number } | null;
  onMarkerSelect?: (id: string) => void;
};

function vehicleIcon(heading?: number | null, estimated = false, selected = false) {
  return L.divIcon({
    className: 'harbour-vehicle-marker',
    html: `<span class="harbour-vehicle-dot${estimated ? ' is-estimated' : ''}${selected ? ' is-selected' : ''}" style="transform: rotate(${heading ?? 0}deg)"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function MapFocus({ target }: { target: { latitude: number; longitude: number } | null | undefined }) {
  const map = useMap();
  const prev = useRef('');
  useEffect(() => {
    if (!target) return;
    const key = `${target.latitude.toFixed(4)}:${target.longitude.toFixed(4)}`;
    if (key === prev.current) return;
    prev.current = key;
    map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 7), { duration: 0.6 });
  }, [map, target]);
  return null;
}

function FitBounds({
  points,
  mode,
}: {
  points: Array<[number, number]>;
  mode: 'follow' | 'frame' | 'none';
}) {
  const map = useMap();
  const fitted = useRef(false);
  const prevCount = useRef(0);
  const prevFrame = useRef('');
  useEffect(() => {
    if (mode === 'none' || points.length === 0) return;
    const last = points[points.length - 1];
    if (mode === 'frame') {
      const bounds = L.latLngBounds(points);
      const frame = [
        bounds.getSouth().toFixed(2),
        bounds.getNorth().toFixed(2),
        bounds.getWest().toFixed(2),
        bounds.getEast().toFixed(2),
        String(points.length),
      ].join(':');
      if (frame === prevFrame.current) return;
      prevFrame.current = frame;
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 6 });
      return;
    }
    const trimmed = prevCount.current > 0 && points.length < prevCount.current;
    prevCount.current = points.length;
    if (points.length === 1) {
      map.setView(last, 7);
      fitted.current = true;
      return;
    }
    if (!fitted.current || trimmed) {
      map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 8 });
      fitted.current = true;
    } else {
      map.panTo(last);
    }
    // maxZoom can clip a long corridor so the current marker sits off-screen.
    if (!map.getBounds().contains(last)) {
      map.setView(last, Math.min(map.getZoom(), 6));
    }
  }, [map, mode, points]);
  return null;
}

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => window.cancelAnimationFrame(frame);
  }, [map]);
  return null;
}

export function JourneyMap({
  map,
  trail = [],
  trails = [],
  markers,
  heightClassName = 'harbour-map',
  showPlannedRoute = false,
  showCorridor = false,
  fitMode = 'follow',
  labelled = false,
  selectedId = null,
  focusTarget = null,
  onMarkerSelect,
}: JourneyMapProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    return () => setReady(false);
  }, []);

  const trailLines = trails.length > 0 ? trails : trail.length > 0 ? [trail] : [];
  const planned = useMemo(() => {
    if (!showPlannedRoute) return [];
    const source = selectedId
      ? markers.filter((marker) => marker.id === selectedId)
      : markers;
    return source
      .map((marker) => remainingCorridorFrom(marker, marker.status))
      .filter((line) => line.length > 1);
  }, [markers, selectedId, showPlannedRoute]);

  const trailLatLngs = useMemo(() => {
    const lines = trails.length > 0 ? trails : trail.length > 0 ? [trail] : [];
    return lines.map((line, index) => ({
      id: markers[index]?.id,
      points: line.map((point) => [point.latitude, point.longitude] as [number, number]),
    }));
  }, [markers, trail, trails]);
  const visibleTrails = selectedId
    ? trailLatLngs.filter((line) => line.id === selectedId)
    : trailLatLngs;
  const plannedLatLngs = planned.map((line) =>
    line.map((point) => [point.latitude, point.longitude] as [number, number]),
  );
  const corridorLatLngs = useMemo(
    () =>
      showCorridor
        ? UK_TO_CYPRUS_ROUTE.map((point) => [point.latitude, point.longitude] as [number, number])
        : [],
    [showCorridor],
  );
  const fitPoints = useMemo(
    () => [
      ...corridorLatLngs,
      ...plannedLatLngs.flat(),
      ...visibleTrails.flatMap((line) => line.points),
      ...markers.map((marker) => [marker.latitude, marker.longitude] as [number, number]),
    ],
    [corridorLatLngs, markers, plannedLatLngs, visibleTrails],
  );

  const shellClass = `relative z-0 overflow-hidden rounded-2xl ${heightClassName}`;

  if (markers.length === 0 && trailLines.every((line) => line.length === 0) && corridorLatLngs.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-mist/50 text-sm text-ink/50 ${shellClass}`}>
        No GPS yet. Assign a tracker to start the trail.
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {ready ? (
        <MapContainer
          center={fitPoints[0] ?? [45.2, 16.4]}
          zoom={5}
          scrollWheelZoom
          className="h-full w-full"
          style={{ height: '100%', width: '100%' }}
          placeholder={<div className="h-full w-full bg-mist/40" />}
        >
          <TileLayer url={map.tileUrl} attribution={map.attribution} maxZoom={map.maxZoom} />
          {corridorLatLngs.length > 1 ? (
            <Polyline
              positions={corridorLatLngs}
              pathOptions={{ color: '#0b1f33', weight: 2, opacity: 0.2, dashArray: '7 11' }}
            />
          ) : null}
          {plannedLatLngs.map((line, index) => (
            <Polyline
              key={`planned-${index}`}
              positions={line}
              pathOptions={{ color: '#1c6b6a', weight: 3, opacity: 0.45, dashArray: '8 10' }}
            />
          ))}
          {visibleTrails.map((line, index) =>
            line.points.length > 1 ? (
              <Polyline
                key={`trail-${line.id ?? index}`}
                positions={line.points}
                pathOptions={{
                  color: line.id === selectedId ? '#0b1f33' : '#1c6b6a',
                  weight: line.id === selectedId ? 5 : 4,
                  opacity: line.id === selectedId ? 1 : 0.55,
                }}
              />
            ) : null,
          )}
          {markers.map((marker) => (
            <Marker
              key={marker.id}
              position={[marker.latitude, marker.longitude]}
              icon={vehicleIcon(marker.heading, marker.estimated, marker.id === selectedId)}
              eventHandlers={
                onMarkerSelect ? { click: () => onMarkerSelect(marker.id) } : undefined
              }
            >
              {labelled ? (
                <Tooltip permanent direction="top" offset={[0, -12]} className="harbour-map-label">
                  {marker.sublabel?.split(' · ')[0] ?? marker.label}
                </Tooltip>
              ) : null}
              <Popup>
                <div className="min-w-40 text-sm">
                  {marker.href ? (
                    <Link to={marker.href} className="font-semibold text-harbour">
                      {marker.label}
                    </Link>
                  ) : (
                    <p className="font-semibold">{marker.label}</p>
                  )}
                  {marker.sublabel ? <p className="text-ink/60">{marker.sublabel}</p> : null}
                  {marker.estimated ? <p className="mt-1 text-[11px] text-ink/45">Estimated from job status</p> : null}
                </div>
              </Popup>
            </Marker>
          ))}
          {focusTarget ? <MapFocus target={focusTarget} /> : null}
          <FitBounds points={fitPoints} mode={focusTarget ? 'none' : fitMode} />
          <InvalidateSize />
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-mist/40" />
      )}
    </div>
  );
}
