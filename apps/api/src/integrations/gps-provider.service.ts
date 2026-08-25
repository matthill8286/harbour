import { Injectable } from '@nestjs/common';
import {
  bearingDegrees,
  densifyRoute,
  nearestRouteIndex,
  routeAnchorLabel,
  UK_TO_CYPRUS_ROUTE,
  type GeoPoint,
  type JobStatus,
} from '@vip/shared';

@Injectable()
export class GpsProviderService {
  readonly route: GeoPoint[] = densifyRoute(UK_TO_CYPRUS_ROUTE, 4);

  anchorForStatus(status: JobStatus) {
    const label = routeAnchorLabel(status);
    const match = this.route.find((point) => point.label === label);
    return match ?? this.route[this.route.length - 1];
  }

  /** Remaining corridor points the trail must include to match the job status. */
  pointsTowardAnchor(
    status: JobStatus,
    current?: { latitude: number; longitude: number } | null,
  ) {
    const targetIndex = nearestRouteIndex(
      this.route,
      this.anchorForStatus(status),
    );
    const startIndex = current ? nearestRouteIndex(this.route, current) + 1 : 0;
    if (startIndex > targetIndex) return [];
    return this.route.slice(startIndex, targetIndex + 1);
  }

  /**
   * True when this ping is already beyond the named waypoint for the job status.
   * Simulated trails must not keep those points when status is the source of truth.
   */
  isPastAnchor(
    status: JobStatus,
    point: { latitude: number; longitude: number },
  ) {
    const targetIndex = nearestRouteIndex(
      this.route,
      this.anchorForStatus(status),
    );
    return nearestRouteIndex(this.route, point) > targetIndex;
  }

  /**
   * How many leading trail points still belong at or before the status anchor.
   * Later corridor pings (and any Cyprus catch-up after a UK reset) are past it.
   */
  keptTrailLength(
    status: JobStatus,
    trail: Array<{ latitude: number; longitude: number }>,
  ) {
    let kept = 0;
    for (const point of trail) {
      if (this.isPastAnchor(status, point)) break;
      kept += 1;
    }
    return kept;
  }

  nextPoint(current?: { latitude: number; longitude: number } | null) {
    if (!current) {
      return this.withMotion(this.route[0], this.route[1]);
    }
    const index = nearestRouteIndex(this.route, current);
    const next = this.route[Math.min(index + 1, this.route.length - 1)];
    const after = this.route[Math.min(index + 2, this.route.length - 1)];
    return this.withMotion(next, after);
  }

  private withMotion(point: GeoPoint, towards: GeoPoint) {
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      label: point.label,
      speed: 78 + Math.round(Math.random() * 18),
      heading: Math.round(bearingDegrees(point, towards) % 360),
      accuracy: 8 + Math.round(Math.random() * 10),
    };
  }
}
