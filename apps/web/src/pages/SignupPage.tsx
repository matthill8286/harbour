import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner, fieldClass, primaryBtn } from '../components/ui';

/**
 * Sign-up, first step. We email a link, and the workspace is created from it,
 * so only the owner of the address can create one with it. On a server that
 * checks licences, the page is reached from a licence link, /signup?licence=<id>,
 * and the API refuses anyone the licence does not name.
 */
const LICENCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SignupPage() {
  const { user, ready } = useAuth();
  const [params] = useSearchParams();
  const licence = params.get('licence') ?? '';
  const licenceId = LICENCE_ID.test(licence) ? licence : undefined;
  const [organisationName, setOrganisationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && user) {
    return <Navigate to={homePath(user)} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ organisationName, name, email: email.trim(), ...(licenceId ? { licenceId } : {}) }),
      });
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start your sign-up');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame
      eyebrow={licenceId ? 'Set up your workspace' : 'Start a free trial'}
      lead="Create a workspace for your import business. Add jobs, track vehicles and invite your team and customers once you are in."
      note="Your data stays inside your own workspace."
    >
      {sentTo ? (
        <div className="space-y-4">
          <h2 className="display text-3xl">Check your email</h2>
          <p className="text-sm text-ink/60">
            We have sent an email to {sentTo}. Open the link in it to finish. If it does not arrive within a few minutes, check your spam folder.
          </p>
          <button type="button" className="block text-sm font-semibold text-harbour" onClick={() => setSentTo(null)}>
            Use a different email or send it again
          </button>
          <Link to="/login" className={`${primaryBtn} w-full py-3`}>
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="display text-3xl">Create your workspace</h2>
          <label className="block text-sm font-semibold">
            Company name
            <input
              className={`${fieldClass} mt-1`}
              value={organisationName}
              onChange={(event) => setOrganisationName(event.target.value)}
              autoComplete="organization"
              minLength={2}
              maxLength={120}
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
              maxLength={120}
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
          <p className="text-sm text-ink/60">We will email you a link to confirm the address. You choose your password there.</p>
          {error ? <ErrorBanner message={error} /> : null}
          <button type="submit" disabled={pending} className={`${primaryBtn} w-full py-3`}>
            {pending ? 'Sending…' : 'Email me a link'}
          </button>
          <p className="text-sm text-ink/60">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-harbour">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
