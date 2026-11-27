import type { PublicUser } from '@vip/shared';
import { failureMessage, SERVER_FAULT, UNREACHABLE } from './errors';

const TOKEN_KEY = 'harbour.token';

export class ApiError extends Error {
  status: number;
  /** A machine-readable reason, when the api sends one. */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** `fetch`, with a lost connection reported in words people can act on. */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`/api${path}`, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(0, UNREACHABLE);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await send(path, { ...init, headers });
  if (!response.ok) {
    let message = failureMessage(response.status);
    let code: string | undefined;
    try {
      const body = (await response.json()) as { message?: string | string[]; code?: string };
      message = failureMessage(response.status, body.message);
      code = body.code;
    } catch {
      /* ignore */
    }
    if (response.status === 403 && code === 'two_factor_required') {
      window.dispatchEvent(new Event('harbour:two-factor-required'));
    }
    // On these routes a 401 is about what was typed, not about the current session.
    const signingIn = path === '/auth/login' || path.startsWith('/auth/two-factor') || path.startsWith('/auth/invites/');
    if (response.status === 401 && !signingIn) {
      setToken(null);
      window.dispatchEvent(new Event('harbour:unauthorized'));
    }
    throw new ApiError(response.status, message, code);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, SERVER_FAULT);
  }
}

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await send(path, { headers });
  if (!response.ok) {
    if (response.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event('harbour:unauthorized'));
    }
    throw new ApiError(response.status, failureMessage(response.status));
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
