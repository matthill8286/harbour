import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import * as L from 'leaflet';
import { nearestRouteIndex, UK_TO_CYPRUS_ROUTE, type LocationPoint, type MapConfig } from '@vip/shared';

type MapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  label: string;
  sublabel?: string;
  href?: string;
};

type JourneyMapProps = {
  map: MapConfig;
  trail?: LocationPoint[];
  trails?: LocationPoint[][];
  markers: MapMarker[];
  heightClassName?: string;
  showPlannedRoute?: boolean;
};

function vehicleIcon(heading?: number | null) {
  return L.divIcon({
    className: 'harbour-vehicle-marker',
    html: `<span class="harbour-vehicle-dot" style="transform: rotate(${heading ?? 0}deg)"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const fitted = useRef(false);
  const prevCount = useRef(0);
  useEffect(() => {
    if (points.length === 0) return;
    const last = points[points.length - 1];
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
  }, [map, points]);
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
}: JourneyMapProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    return () => setReady(false);
  }, []);

  const trailLines = trails.length > 0 ? trails : trail.length > 0 ? [trail] : [];
  const current = markers[0];
  const planned = useMemo(() => {
    if (!showPlannedRoute || !current) return [];
    const index = nearestRouteIndex(UK_TO_CYPRUS_ROUTE, current);
    return UK_TO_CYPRUS_ROUTE.slice(index);
  }, [current, showPlannedRoute]);

  const trailLatLngs = useMemo(() => {
    const lines = trails.length > 0 ? trails : trail.length > 0 ? [trail] : [];
    return lines.map((line) => line.map((point) => [point.latitude, point.longitude] as [number, number]));
  }, [trail, trails]);
  const plannedLatLngs = planned.map((point) => [point.latitude, point.longitude] as [number, number]);
  const fitPoints = useMemo(
    () => [
      ...trailLatLngs.flat(),
      ...markers.map((marker) => [marker.latitude, marker.longitude] as [number, number]),
    ],
    [markers, trailLatLngs],
  );

  const shellClass = `relative z-0 overflow-hidden rounded-2xl ${heightClassName}`;

  if (markers.length === 0 && trailLines.every((line) => line.length === 0)) {
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
          {plannedLatLngs.length > 1 ? (
            <Polyline
              positions={plannedLatLngs}
              pathOptions={{ color: '#0b1f33', weight: 2, opacity: 0.28, dashArray: '8 10' }}
            />
          ) : null}
          {trailLatLngs.map((line, index) =>
            line.length > 1 ? (
              <Polyline
                key={`trail-${index}`}
                positions={line}
                pathOptions={{ color: '#1c6b6a', weight: 4, opacity: 0.9 }}
              />
            ) : null,
          )}
          {markers.map((marker) => (
            <Marker
              key={marker.id}
              position={[marker.latitude, marker.longitude]}
              icon={vehicleIcon(marker.heading)}
            >
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
                </div>
              </Popup>
            </Marker>
          ))}
          <FitBounds points={fitPoints} />
          <InvalidateSize />
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-mist/40" />
      )}
    </div>
  );
}
