import {
  formatUkRegistration,
  normalizeRegistrationKey,
  plateFromFilename,
} from './vehicle-registration';

describe('vehicle-registration helpers', () => {
  it('normalizes and formats UK plates', () => {
    expect(normalizeRegistrationKey('kn19 xpl')).toBe('KN19XPL');
    expect(formatUkRegistration('kn19xpl')).toBe('KN19 XPL');
  });

  it('extracts a plate from a filename', () => {
    expect(plateFromFilename('KN19XPL.jpg')).toBe('KN19XPL');
    expect(plateFromFilename('front-bumper.png')).toBeNull();
  });
});
