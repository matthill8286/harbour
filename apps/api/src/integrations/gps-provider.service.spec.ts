import { nearestRouteIndex } from '@vip/shared';
import { GpsProviderService } from './gps-provider.service';

describe('GpsProviderService.nextPoint', () => {
  const gps = new GpsProviderService();

  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts at the first UK waypoint', () => {
    const point = gps.nextPoint();
    expect(point.latitude).toBe(gps.route[0].latitude);
    expect(point.longitude).toBe(gps.route[0].longitude);
  });

  it('advances along the densified UK-to-Cyprus route', () => {
    const current = gps.nextPoint();
    const next = gps.nextPoint(current);
    expect(nearestRouteIndex(gps.route, next)).toBeGreaterThan(nearestRouteIndex(gps.route, current));
  });

  it('stays on the last waypoint once the route is complete', () => {
    const last = gps.route[gps.route.length - 1];
    const point = gps.nextPoint(last);
    expect(point.latitude).toBe(last.latitude);
    expect(point.longitude).toBe(last.longitude);
  });

  it('catches a Greece ping up to Limassol when the job has arrived in Cyprus', () => {
    const piraeus = { latitude: 37.942, longitude: 23.646 };
    const points = gps.pointsTowardAnchor('ARRIVED_CYPRUS', piraeus);
    expect(points.length).toBeGreaterThan(0);
    expect(points[points.length - 1].label).toBe('Limassol');
    expect(gps.pointsTowardAnchor('ARRIVED_CYPRUS', points[points.length - 1])).toEqual([]);
  });
});
