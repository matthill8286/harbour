import { gpsRetentionDays } from './gps-retention';

describe('gpsRetentionDays', () => {
  it('is 90 days unless set', () => {
    expect(gpsRetentionDays(undefined)).toBe(90);
    expect(gpsRetentionDays('  ')).toBe(90);
  });

  it.each(['30', ' 180 ', '3650'])('accepts %s', (value) => {
    expect(gpsRetentionDays(value)).toBe(Number(value));
  });

  it.each([
    '0',
    '-90',
    '1',
    '29',
    '3651',
    '90.5',
    '1e3',
    '0x5a',
    '90 days',
    'ninety',
    'NaN',
    'Infinity',
  ])('refuses %s', (value) => {
    expect(() => gpsRetentionDays(value)).toThrow('GPS_RETENTION_DAYS');
  });
});
