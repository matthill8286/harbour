import { create } from 'zustand';
import { isPortalRole, isStaffRole, type PublicUser } from '@vip/shared';
import {
  api,
  ApiError,
  getToken,
  isChallenge,
  setToken,
  type LoginResponse,
  type SessionResponse,
} from './api';

/** What a password sign-in produced: a session, or a two-factor step still to do. */
export type SignInResult =
  | { kind: 'session'; user: PublicUser }
  | { kind: 'two-factor' };

type Challenge = { token: string; expiresAt: number };

type AuthState = {
  user: PublicUser | null;
  ready: boolean;
  challenge: Challenge | null;
  login: (email: string, password: string) => Promise<SignInResult>;
  acceptInvite: (token: string, password: string) => Promise<SignInResult>;
  completeChallenge: (input: { code?: string; backupCode?: string }) => Promise<PublicUser>;
  refresh: () => Promise<PublicUser | null>;
  logout: () => void;
  hydrate: () => Promise<void>;
};

export const useAuth = create<AuthState>((set, get) => {
  function start(result: LoginResponse): SignInResult {
    if (isChallenge(result)) {
      setToken(null);
      set({
        user: null,
        ready: true,
        challenge: {
          token: result.challengeToken,
          expiresAt: Date.now() + result.expiresIn * 1000,
        },
      });
      return { kind: 'two-factor' };
    }
    setToken(result.accessToken);
    set({ user: result.user, ready: true, challenge: null });
    return { kind: 'session', user: result.user };
  }

  return {
    user: null,
    ready: false,
    challenge: null,
    login: async (email, password) =>
      start(
        await api<LoginResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        }),
      ),
    acceptInvite: async (token, password) =>
      start(
        await api<LoginResponse>(`/auth/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
          body: JSON.stringify({ password }),
        }),
      ),
    completeChallenge: async (input) => {
      const challenge = get().challenge;
      if (!challenge || challenge.expiresAt <= Date.now()) {
        set({ challenge: null });
        throw new ApiError(401, 'This sign-in has expired. Enter your email and password again.');
      }
      const result = await api<SessionResponse>('/auth/two-factor/challenge', {
        method: 'POST',
        body: JSON.stringify({ challengeToken: challenge.token, ...input }),
      });
      setToken(result.accessToken);
      set({ user: result.user, ready: true, challenge: null });
      return result.user;
    },
    refresh: async () => {
      const user = await api<PublicUser>('/auth/me');
      set({ user, ready: true });
      return user;
    },
    logout: () => {
      setToken(null);
      set({ user: null, ready: true, challenge: null });
    },
    hydrate: async () => {
      if (!getToken()) {
        set({ user: null, ready: true });
        return;
      }
      try {
        const user = await api<PublicUser>('/auth/me');
        set({ user, ready: true });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setToken(null);
          set({ user: null, ready: true });
          return;
        }
        window.setTimeout(() => {
          void useAuth.getState().hydrate();
        }, 1000);
      }
    },
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('harbour:unauthorized', () => {
    setToken(null);
    useAuth.setState({ user: null, ready: true });
  });
  // The api says this account still needs two-factor setup, so reload it and let the router redirect.
  window.addEventListener('harbour:two-factor-required', () => {
    void useAuth
      .getState()
      .refresh()
      .catch(() => undefined);
  });
}

/** Where a signed-in user lands: staff without two-factor go to setup first. */
export function homePath(user: PublicUser): string {
  if (isStaffRole(user.role) && !user.twoFactorEnabled) return '/security/setup';
  return isPortalRole(user.role) ? '/portal' : '/';
}
