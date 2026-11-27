import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@vip/shared';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
});
vi.stubGlobal('window', new EventTarget());
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

type AuthModule = typeof import('./auth');
let auth: AuthModule;

const staff: PublicUser = {
  id: 'user-1',
  membershipId: 'mem-1',
  organisationId: 'org-1',
  organisationName: 'Demo',
  organisationBrandName: 'Demo',
  organisationCurrency: 'EUR',
  organisationCountry: 'CY',
  email: 'staff@demo.local',
  name: 'Staff',
  role: 'STAFF',
  customerId: null,
  twoFactorEnabled: true,
};

function reply(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeAll(async () => {
  auth = await import('./auth');
});

beforeEach(() => {
  store.clear();
  fetchMock.mockReset();
  auth.useAuth.getState().logout();
});

describe('homePath', () => {
  it('sends staff without two-factor to setup first', () => {
    expect(auth.homePath({ ...staff, twoFactorEnabled: false })).toBe('/security/setup');
    expect(auth.homePath(staff)).toBe('/');
  });

  it('does not make customers set up two-factor', () => {
    const customer = { ...staff, role: 'CUSTOMER' as const, twoFactorEnabled: false };
    expect(auth.homePath(customer)).toBe('/portal');
  });
});

describe('two-step sign-in', () => {
  it('keeps no session token until the code is accepted', async () => {
    fetchMock.mockReturnValueOnce(reply({ twoFactorRequired: true, challengeToken: 'challenge-1', expiresIn: 600 }));
    const result = await auth.useAuth.getState().login('staff@demo.local', 'pw');
    expect(result).toEqual({ kind: 'two-factor' });
    expect(store.get('harbour.token')).toBeUndefined();
    expect(auth.useAuth.getState().user).toBeNull();

    fetchMock.mockReturnValueOnce(reply({ accessToken: 'access-1', user: staff }));
    const user = await auth.useAuth.getState().completeChallenge({ code: '123456' });
    expect(user).toEqual(staff);
    expect(store.get('harbour.token')).toBe('access-1');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/auth/two-factor/challenge');
    expect(JSON.parse(String(init.body))).toEqual({ challengeToken: 'challenge-1', code: '123456' });
    expect(auth.useAuth.getState().challenge).toBeNull();
  });

  it('signs straight in when two-factor is off', async () => {
    fetchMock.mockReturnValueOnce(reply({ accessToken: 'access-2', user: staff }));
    const result = await auth.useAuth.getState().login('staff@demo.local', 'pw');
    expect(result).toEqual({ kind: 'session', user: staff });
    expect(store.get('harbour.token')).toBe('access-2');
  });

  it('keeps the challenge after a wrong code so the user can try again', async () => {
    fetchMock.mockReturnValueOnce(reply({ twoFactorRequired: true, challengeToken: 'challenge-2', expiresIn: 600 }));
    await auth.useAuth.getState().login('staff@demo.local', 'pw');
    fetchMock.mockReturnValueOnce(reply({ message: 'That code is not right.' }, 401));
    await expect(auth.useAuth.getState().completeChallenge({ code: '000000' })).rejects.toThrow('That code is not right.');
    expect(auth.useAuth.getState().challenge?.token).toBe('challenge-2');
  });

  it('refuses an expired challenge without calling the api', async () => {
    auth.useAuth.setState({ challenge: { token: 'old', expiresAt: Date.now() - 1 } });
    await expect(auth.useAuth.getState().completeChallenge({ code: '123456' })).rejects.toThrow('expired');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
