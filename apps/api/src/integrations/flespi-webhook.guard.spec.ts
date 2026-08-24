import { secretsMatch } from './flespi-webhook.guard';

describe('secretsMatch', () => {
  it('accepts the configured webhook secret', () => {
    expect(secretsMatch('harbour-secret', 'harbour-secret')).toBe(true);
  });

  it('rejects a different secret', () => {
    expect(secretsMatch('harbour-secret', 'other')).toBe(false);
    expect(secretsMatch('', 'harbour-secret')).toBe(false);
  });
});
