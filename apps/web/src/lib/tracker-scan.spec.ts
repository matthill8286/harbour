import { describe, expect, it } from 'vitest';
import { parseTrackerImeiFromScan } from './tracker-scan';

describe('parseTrackerImeiFromScan', () => {
  it('returns null for empty input', () => {
    expect(parseTrackerImeiFromScan('')).toBeNull();
    expect(parseTrackerImeiFromScan('   ')).toBeNull();
  });

  it('accepts a plain 15-digit IMEI', () => {
    expect(parseTrackerImeiFromScan('352094123456789')).toBe('352094123456789');
  });

  it('strips non-digits around an IMEI', () => {
    expect(parseTrackerImeiFromScan('IMEI 3520-9412-3456-789')).toBe('352094123456789');
  });

  it('parses labelled text payloads', () => {
    expect(parseTrackerImeiFromScan('IMEI:352094123456789')).toBe('352094123456789');
    expect(parseTrackerImeiFromScan('serial=352094123456789')).toBe('352094123456789');
    expect(parseTrackerImeiFromScan('S/N 352094123456789')).toBe('352094123456789');
  });

  it('parses JSON payloads with common keys', () => {
    expect(parseTrackerImeiFromScan('{"imei":"352094123456789"}')).toBe('352094123456789');
    expect(parseTrackerImeiFromScan('{"serialNumber":"352094123456789"}')).toBe('352094123456789');
    expect(parseTrackerImeiFromScan('{"ident":"352094123456789"}')).toBe('352094123456789');
  });

  it('parses URL query parameters', () => {
    expect(parseTrackerImeiFromScan('https://device.local/?imei=352094123456789')).toBe(
      '352094123456789',
    );
    expect(parseTrackerImeiFromScan('https://device.local/?serial=352094123456789&x=1')).toBe(
      '352094123456789',
    );
  });

  it('accepts demo simulator serials', () => {
    expect(parseTrackerImeiFromScan('TRK-001')).toBe('TRK-001');
    expect(parseTrackerImeiFromScan('trk-42')).toBe('TRK-42');
  });

  it('rejects payloads without a usable serial', () => {
    expect(parseTrackerImeiFromScan('hello world')).toBeNull();
    expect(parseTrackerImeiFromScan('12345')).toBeNull();
    expect(parseTrackerImeiFromScan('{"name":"tracker"}')).toBeNull();
  });
});
