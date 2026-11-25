import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { isPortalRole } from '@vip/shared';
import { api, setToken, type LoginResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBanner, fieldClass, primaryBtn } from '../components/ui';

/** Self-serve sign-up: a new importer gets their own workspace on a trial, as its owner. */
export function SignupPage() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const [organisationName, setOrganisationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && user) {
    return <Navigate to={isPortalRole(user.role) ? '/portal' : '/'} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api<LoginResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ organisationName, name, email, password }),
      });
      setToken(result.accessToken);
      useAuth.setState({ user: result.user, ready: true });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your workspace');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-svh bg-ink text-paper">
      <div className="mx-auto grid min-h-svh max-w-5xl md:grid-cols-2">
        <section className="hidden flex-col justify-between p-10 md:flex">
          <p className="text-xs uppercase tracking-[0.28em] text-mist">Start a free trial</p>
          <div>
            <h1 className="display text-5xl leading-tight">Harbour</h1>
            <p className="mt-4 max-w-sm text-mist">
              Create a workspace for your import business. Add jobs, track vehicles and invite your
              team and customers once you are in.
            </p>
          </div>
          <p className="text-sm text-mist">Your data stays inside your own workspace.</p>
        </section>
        <section className="flex items-center bg-sand p-6 text-ink md:p-12">
          <form onSubmit={onSubmit} className="w-full max-w-md space-y-4">
            <p className="display text-lg md:hidden">Harbour</p>
            <h2 className="display text-3xl">Create your workspace</h2>
            <label className="block text-sm font-semibold">
              Company name
              <input
                className={`${fieldClass} mt-1`}
                value={organisationName}
                onChange={(event) => setOrganisationName(event.target.value)}
                autoComplete="organization"
                minLength={2}
                required
                autoFocus
              />
            </label>
            <label className="block text-sm font-semibold">
              Your name
              <input
                className={`${fieldClass} mt-1`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label className="block text-sm font-semibold">
              Work email
              <input
                type="email"
                className={`${fieldClass} mt-1`}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
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
            <p className="text-sm text-ink/60">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-harbour">
                Sign in
              </Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
