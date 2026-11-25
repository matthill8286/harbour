import { useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner, fieldClass, LoadingScreen, primaryBtn } from '../components/ui';

type ResetPreview = { email: string; expiresAt: string };

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const logout = useAuth((state) => state.logout);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const preview = useQuery({
    queryKey: ['password-reset', token],
    queryFn: () => api<ResetPreview>(`/auth/password/reset/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) return <Navigate to="/forgot-password" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      // Every older session has ended, including one in this browser.
      logout();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="Password reset"
      lead="Choose a new password. Any device still signed in with the old one will be signed out."
    >
      {preview.isLoading ? <LoadingScreen label="Checking your link…" /> : null}
      {preview.error ? (
        <div className="space-y-4">
          <h2 className="display text-3xl">Link not valid</h2>
          <ErrorBanner message={preview.error.message} />
          <Link to="/forgot-password" className={`${primaryBtn} w-full py-3`}>
            Ask for a new link
          </Link>
        </div>
      ) : null}
      {preview.data && done ? (
        <div className="space-y-4">
          <h2 className="display text-3xl">Password changed</h2>
          <p className="text-sm text-ink/60">Sign in with your new password.</p>
          <Link to="/login" className={`${primaryBtn} w-full py-3`}>
            Sign in
          </Link>
        </div>
      ) : null}
      {preview.data && !done ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="display text-3xl">Choose a new password</h2>
          <p className="text-sm text-ink/60">For {preview.data.email}. Use at least 10 characters.</p>
          <label className="block text-sm font-semibold">
            New password
            <input
              type="password"
              className={`${fieldClass} mt-1`}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
              autoFocus
            />
          </label>
          <label className="block text-sm font-semibold">
            Confirm new password
            <input
              type="password"
              className={`${fieldClass} mt-1`}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </label>
          {error ? <ErrorBanner message={error} /> : null}
          <button type="submit" disabled={pending} className={`${primaryBtn} w-full py-3`}>
            {pending ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      ) : null}
    </AuthFrame>
  );
}
