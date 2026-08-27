import { plannedRouteForJob } from './planned-route';

describe('plannedRouteForJob', () => {
  const waypoints = [
    { label: 'London', latitude: 51.5, longitude: -0.1 },
    { label: 'Sofia', latitude: 42.7, longitude: 23.3 },
    { label: 'Limassol', latitude: 34.7, longitude: 33.0 },
  ];

  it('returns the full template when there is no ping', () => {
    expect(
      plannedRouteForJob({
        status: 'COLLECTED',
        current: null,
        waypoints,
      }),
    ).toEqual(waypoints);
  });

  it('returns nothing after arrival', () => {
    expect(
      plannedRouteForJob({
        status: 'ARRIVED_CYPRUS',
        current: waypoints[1],
        waypoints,
      }),
    ).toEqual([]);
  });
});
