import { useEffect, useMemo, useRef } from 'react';
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
  useEffect(() => {
    if (points.length === 0) return;
    const last = points[points.length - 1];
    if (fitted.current) {
      map.panTo(last);
      return;
    }
    fitted.current = true;
    if (points.length === 1) {
      map.setView(last, 7);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 8 });
  }, [map, points]);
  return null;
}

export function JourneyMap({
  map,
  trail = [],
  trails = [],
  markers,
  heightClassName = 'h-[22rem] md:h-[28rem]',
  showPlannedRoute = false,
}: JourneyMapProps) {
  const trailLines = trails.length > 0 ? trails : trail.length > 0 ? [trail] : [];
  const current = markers[0];
  const planned = useMemo(() => {
    if (!showPlannedRoute || !current) return [];
    const index = nearestRouteIndex(UK_TO_CYPRUS_ROUTE, current);
    return UK_TO_CYPRUS_ROUTE.slice(index);
  }, [current, showPlannedRoute]);

  const trailLatLngs = trailLines.map((line) =>
    line.map((point) => [point.latitude, point.longitude] as [number, number]),
  );
  const plannedLatLngs = planned.map((point) => [point.latitude, point.longitude] as [number, number]);
  const fitPoints = useMemo(
    () => [
      ...trailLatLngs.flat(),
      ...markers.map((marker) => [marker.latitude, marker.longitude] as [number, number]),
    ],
    [markers, trailLatLngs],
  );

  if (markers.length === 0 && trailLines.every((line) => line.length === 0)) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl bg-mist/50 text-sm text-ink/50 ${heightClassName}`}
      >
        No GPS yet. Assign a tracker to start the trail.
      </div>
    );
  }

  return (
    <div className={`relative z-0 overflow-hidden rounded-2xl ${heightClassName}`}>
      <MapContainer
        center={fitPoints[0] ?? [45.2, 16.4]}
        zoom={5}
        scrollWheelZoom
        className="h-full w-full"
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
      </MapContainer>
    </div>
  );
}
