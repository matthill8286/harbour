import { lazy, Suspense, type ComponentProps } from 'react';
import { ChunkLoadError } from '../lib/chunk-load';
import { MapBoundary } from './MapBoundary';

// The map library is large and most pages have no map. A failed load does not reload the
// tab on its own, because the page around the map may hold something half typed.
const JourneyMapView = lazy(() =>
  import('./JourneyMapView').then(
    (module) => ({ default: module.JourneyMapView }),
    (error: unknown) => {
      throw new ChunkLoadError(error);
    },
  ),
);

export function JourneyMap(props: ComponentProps<typeof JourneyMapView>) {
  const shellClass = `relative z-0 overflow-hidden rounded-2xl ${props.heightClassName ?? 'harbour-map'}`;
  return (
    <MapBoundary className={shellClass}>
      <Suspense fallback={<div role="status" aria-label="Loading map" className={`bg-mist/40 ${shellClass}`} />}>
        <JourneyMapView {...props} />
      </Suspense>
    </MapBoundary>
  );
}
