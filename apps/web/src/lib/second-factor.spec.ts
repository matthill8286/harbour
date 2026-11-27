import { describe, expect, it } from 'vitest';
import { secondFactor } from './api';

describe('secondFactor', () => {
  it('reads six digits as an authenticator code and anything else as a backup code', () => {
    expect(secondFactor(' 123 456 ')).toEqual({ code: '123456' });
    expect(secondFactor(' abcde-12345 ')).toEqual({ backupCode: 'abcde-12345' });
  });
});
