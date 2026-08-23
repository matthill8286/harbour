import { create } from 'zustand';
import type { PublicUser } from '@vip/shared';
import { api, getToken, setToken, type LoginResponse } from './api';

type AuthState = {
  user: PublicUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<PublicUser>;
  acceptInvite: (token: string, password: string) => Promise<PublicUser>;
  logout: () => void;
  hydrate: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  login: async (email, password) => {
    const result = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(result.accessToken);
    set({ user: result.user, ready: true });
    return result.user;
  },
  acceptInvite: async (token, password) => {
    const result = await api<LoginResponse>(`/auth/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setToken(result.accessToken);
    set({ user: result.user, ready: true });
    return result.user;
  },
  logout: () => {
    setToken(null);
    set({ user: null, ready: true });
  },
  hydrate: async () => {
    if (!getToken()) {
      set({ user: null, ready: true });
      return;
    }
    try {
      const user = await api<PublicUser>('/auth/me');
      set({ user, ready: true });
    } catch {
      setToken(null);
      set({ user: null, ready: true });
    }
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('harbour:unauthorized', () => {
    setToken(null);
    useAuth.setState({ user: null, ready: true });
  });
}
