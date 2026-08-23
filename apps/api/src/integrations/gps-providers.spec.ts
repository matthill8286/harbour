import { isSimulatedGpsProvider } from './gps-providers';

describe('isSimulatedGpsProvider', () => {
  it('treats generic demo units as simulated', () => {
    expect(isSimulatedGpsProvider('generic')).toBe(true);
    expect(isSimulatedGpsProvider(undefined)).toBe(true);
  });

  it('treats Flespi/Teltonika units as live', () => {
    expect(isSimulatedGpsProvider('flespi')).toBe(false);
    expect(isSimulatedGpsProvider('teltonika')).toBe(false);
  });
});
