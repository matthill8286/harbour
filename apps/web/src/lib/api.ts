import type { PublicUser } from '@vip/shared';

const TOKEN_KEY = 'harbour.token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { message?: string | string[]; code?: string };
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
      code = body.code;
    } catch {
      /* ignore */
    }
    if (response.status === 403 && code === 'two_factor_required') {
      window.dispatchEvent(new Event('harbour:two-factor-required'));
    }
    if (response.status === 401 && path !== '/auth/login' && !path.startsWith('/auth/two-factor')) {
      setToken(null);
      window.dispatchEvent(new Event('harbour:unauthorized'));
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { headers });
  if (!response.ok) {
    if (response.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event('harbour:unauthorized'));
    }
    throw new ApiError(response.status, response.statusText);
  }
  return response.blob();
}

export async function downloadApiFile(path: string, filename: string) {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type SessionResponse = {
  accessToken: string;
  user: PublicUser;
};

/** The password was right, but the account has two-factor sign-in on and a code is due. */
export type TwoFactorChallenge = {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
};

export type LoginResponse = SessionResponse | TwoFactorChallenge;

export function isChallenge(result: LoginResponse): result is TwoFactorChallenge {
  return 'twoFactorRequired' in result && result.twoFactorRequired === true;
}

export type TwoFactorSetup = {
  totpURI: string;
  secret: string;
  backupCodes: string[];
};

/** What someone typed as their second step: six digits are an authenticator code. */
export function secondFactor(value: string): { code: string } | { backupCode: string } {
  const digits = value.replace(/\s/g, '');
  return /^\d{6}$/.test(digits) ? { code: digits } : { backupCode: value.trim() };
}

export type TwoFactorStatus = {
  enabled: boolean;
  backupCodesRemaining: number;
};
