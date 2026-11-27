import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame, AuthNotice } from '../components/AuthFrame';

/** The API's answer when every membership the account has is disabled. */
const ACCESS_OFF = 'No active organisation for this account';

/**
 * Sign in, after the Figma frames "Auth · Login". It also says why the last
 * session ended (signed out, or expired), and when access has been turned off.
 */
export function LoginPage() {
  const { user, ready, login, ended, clearEnded } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [accessOff, setAccessOff] = useState(false);
  const [pending, setPending] = useState(false);

  if (ready && user) return <Navigate to={homePath(user)} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.email.trim() || !form.password) {
      setError('Enter your email and password.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await login(form.email, form.password);
      navigate(result.kind === 'two-factor' ? '/two-factor' : homePath(result.user));
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === ACCESS_OFF) setAccessOff(true);
      else setError('Unable to sign in. Check your email and password and try again.');
    } finally {
      setPending(false);
    }
  }

  if (accessOff) {
    return (
      <AuthFrame>
        <AuthNotice
          title="Your access is turned off"
          lead="Your access to this workspace has been turned off. Contact the person who runs it to switch it back on."
        >
          <Button variant="secondary" onClick={() => setAccessOff(false)}>
            Back to sign in
          </Button>
        </AuthNotice>
      </AuthFrame>
    );
  }

  if (ended) {
    const expired = ended === 'expired';
    return (
      <AuthFrame>
        <AuthNotice
          title={expired ? 'Your session has expired' : 'You have signed out'}
          lead={
            expired
              ? 'For security you were signed out after a period without activity. Sign in to pick up where you left off.'
              : 'Your session on this device has ended. Sign in again whenever you need to.'
          }
        >
          <Button onClick={clearEnded}>{expired ? 'Sign in' : 'Sign in again'}</Button>
        </AuthNotice>
      </AuthFrame>
    );
  }

  const set = (key: 'email' | 'password') => (event: CustomEvent<{ value: string }>) => {
    const value = event.detail.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <AuthFrame>
      <div className="auth-intro">
        <Heading level={1} size="3xl" className="auth-title">
          Sign in
        </Heading>
        <Text tone="muted">Sign in to your organisation workspace.</Text>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form className="auth-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextInput label="Email" type="email" autocomplete="username" value={form.email} onChange={set('email')} />
        <TextInput label="Password" type="password" autocomplete="current-password" value={form.password} onChange={set('password')} />
        <Link to="/forgot-password" className="auth-link">
          Forgot your password?
        </Link>
        <Button type="submit" full busy={pending} busyLabel="Signing in">
          Continue
        </Button>
      </form>
      <p className="auth-aside">
        New importer?{' '}
        <Link to="/signup" className="auth-link">
          Start a free trial
        </Link>
      </p>
      <details className="auth-demo">
        <summary>Local demo accounts</summary>
        <p>
          Demo Imports admin: admin@demo-imports.local / ChangeMe!Admin1
          <br />
          Staff: staff@demo-imports.local / ChangeMe!Staff1
          <br />
          Customer portal: customer@example.com / ChangeMe!Customer1
          <br />
          Second tenant admin: owner@cyprus-auto.local / ChangeMe!Admin1
        </p>
      </details>
    </AuthFrame>
  );
}
