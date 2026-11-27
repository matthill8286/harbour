import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiBlob, ApiError } from './api';
import { cameraMessage, failureMessage, SERVER_FAULT, UNREACHABLE } from './errors';

afterEach(() => vi.unstubAllGlobals());

function answer(respond: () => Promise<Response>) {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('fetch', respond);
}

describe('failure messages', () => {
  it("keeps the api's own wording for expected mistakes and for 503", () => {
    expect(failureMessage(400, ['Enter an email', 'Enter a name'])).toBe('Enter an email, Enter a name');
    expect(failureMessage(503, 'Email is not set up.')).toBe('Email is not set up.');
  });

  it('hides server faults', () => {
    expect(failureMessage(500, 'Internal server error')).toBe(SERVER_FAULT);
    expect(failureMessage(502)).toBe(SERVER_FAULT);
  });

  it('turns a lost connection into a plain sentence', async () => {
    answer(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api('/jobs')).rejects.toMatchObject({ status: 0, message: UNREACHABLE });
    await expect(apiBlob('/files/1')).rejects.toMatchObject({ status: 0, message: UNREACHABLE });
  });

  it('leaves a cancelled request alone', async () => {
    answer(() => Promise.reject(new DOMException('Aborted', 'AbortError')));
    await expect(api('/jobs')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not show a proxy error page or a status line', async () => {
    answer(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })));
    await expect(api('/jobs')).rejects.toMatchObject({ status: 502, message: SERVER_FAULT });
    await expect(apiBlob('/files/1')).rejects.toBeInstanceOf(ApiError);
  });

  it('does not show a parser error when an answer is not JSON', async () => {
    answer(() => Promise.resolve(new Response('<html></html>', { status: 200 })));
    await expect(api('/jobs')).rejects.toMatchObject({ message: SERVER_FAULT });
  });

  it('explains camera failures without the library text', () => {
    expect(cameraMessage('Error getting userMedia, error = NotAllowedError: Permission denied')).toMatch(/refused/);
    expect(cameraMessage(new DOMException('x', 'NotFoundError'))).toMatch(/No camera/);
    expect(cameraMessage('weird')).not.toContain('weird');
  });
});
