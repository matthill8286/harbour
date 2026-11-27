import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type SessionResponse } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner, fieldClass, LoadingScreen, primaryBtn } from '../components/ui';

type SignupPreview = {
  email: string;
  organisationName: string;
  name: string;
  expiresAt: string;
};

/** Self-serve sign-up, second step, reached from the emailed link. */
export function SignupConfirmPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user, adopt, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const preview = useQuery({
    queryKey: ['signup', token],
    queryFn: () => api<SignupPreview>(`/auth/signup/confirm/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
    // The link stops working once used, which must not replace the page.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (!token) return <Navigate to="/signup" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const session = await api<SessionResponse>('/auth/signup/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      adopt(session);
      navigate(homePath(session.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your workspace');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="Start a free trial"
      lead="Your email is confirmed by this link. Choose a password to create your workspace."
      note="Your data stays inside your own workspace."
    >
      {preview.isLoading ? <LoadingScreen label="Checking your link…" /> : null}
      {preview.error ? (
        <div className="space-y-4">
          <h2 className="display text-3xl">Link not valid</h2>
          <ErrorBanner message={preview.error.message} />
          <Link to={user ? homePath(user) : '/signup'} className={`${primaryBtn} w-full py-3`}>
            {user ? 'Open Harbour' : 'Sign up again'}
          </Link>
        </div>
      ) : null}
      {preview.data && user && !pending ? (
        <div className="space-y-4">
          <h2 className="display text-3xl">You are signed in</h2>
          <p className="text-sm text-ink/60">
            This browser is signed in as {user.email}. Sign out to create the workspace for {preview.data.email}.
          </p>
          <button type="button" className={`${primaryBtn} w-full py-3`} onClick={logout}>
            Sign out
          </button>
        </div>
      ) : null}
      {preview.data && (!user || pending) ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="display text-3xl">Choose your password</h2>
          <p className="text-sm text-ink/60">
            This creates the workspace {preview.data.organisationName} for {preview.data.name}, signing in as {preview.data.email}. Use at least 10 characters.
          </p>
          <label className="block text-sm font-semibold">
            Password
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
            Confirm password
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
            {pending ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
      ) : null}
    </AuthFrame>
  );
}
