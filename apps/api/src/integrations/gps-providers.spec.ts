import { isSimulatedGpsProvider } from './gps-providers';

describe('isSimulatedGpsProvider', () => {
  it('treats generic demo units as simulated', () => {
    expect(isSimulatedGpsProvider('generic')).toBe(true);
    expect(isSimulatedGpsProvider(' Demo ')).toBe(true);
  });

  it('never assumes a missing provider is simulated', () => {
    expect(isSimulatedGpsProvider(undefined)).toBe(false);
    expect(isSimulatedGpsProvider('')).toBe(false);
  });

  it('treats Flespi/Teltonika units as live', () => {
    expect(isSimulatedGpsProvider('flespi')).toBe(false);
    expect(isSimulatedGpsProvider('teltonika')).toBe(false);
  });
});
