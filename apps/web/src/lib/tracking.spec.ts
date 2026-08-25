import { describe, expect, it } from 'vitest';
import { spreadOverlappingMarkers, trackerKindLabel } from './tracking';

describe('trackerKindLabel', () => {
  it('labels flespi as Teltonika / Flespi', () => {
    expect(trackerKindLabel('flespi')).toBe('Teltonika / Flespi');
  });

  it('labels other providers as the demo simulator', () => {
    expect(trackerKindLabel('generic')).toBe('Demo simulator');
  });
});

describe('spreadOverlappingMarkers', () => {
  it('leaves unique positions unchanged', () => {
    const markers = [
      { id: 'a', latitude: 51.5, longitude: -0.1 },
      { id: 'b', latitude: 52.5, longitude: -1.1 },
    ];
    expect(spreadOverlappingMarkers(markers)).toEqual(markers);
  });

  it('nudges markers that share the same rounded coordinates', () => {
    const markers = [
      { id: 'a', latitude: 51.501, longitude: -0.12 },
      { id: 'b', latitude: 51.502, longitude: -0.121 },
    ];
    const spread = spreadOverlappingMarkers(markers, 0.55);
    expect(spread[0]).toEqual(markers[0]);
    expect(spread[1].latitude).toBeLessThan(markers[1].latitude);
    expect(spread[1].longitude).toBeGreaterThan(markers[1].longitude);
    expect(spread[1].id).toBe('b');
  });
});
