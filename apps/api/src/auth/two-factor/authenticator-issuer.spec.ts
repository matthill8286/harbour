import { authenticatorIssuer } from './two-factor.service';

describe('authenticatorIssuer', () => {
  it('names the live site plainly', () => {
    expect(authenticatorIssuer('https://harbour.weareimpakt.com')).toBe(
      'Harbour',
    );
  });

  it('marks a local copy, however it is addressed', () => {
    for (const origin of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://harbour.test',
      undefined,
    ]) {
      expect(authenticatorIssuer(origin)).toBe('Harbour (localhost)');
    }
  });

  it('marks staging', () => {
    expect(authenticatorIssuer('https://harbour.staging.weareimpakt.com')).toBe(
      'Harbour (staging)',
    );
    expect(authenticatorIssuer('https://staging-harbour.example.com')).toBe(
      'Harbour (staging)',
    );
  });

  it('names any other site by its host, and uses the first of several origins', () => {
    expect(
      authenticatorIssuer('https://imports.example.com, http://localhost:5173'),
    ).toBe('Harbour (imports.example.com)');
  });
});
