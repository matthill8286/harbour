import { useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthFrame, AuthNotice } from '../components/AuthFrame';
import { LoadingScreen } from '../components/ui';

type ResetPreview = { email: string; expiresAt: string };

/** Choosing a new password from a reset link, after the Figma frames "Auth · Reset password". */
export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const { logout, clearEnded } = useAuth();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [tried, setTried] = useState(false);
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

  const short = form.password.length < 10;
  const mismatch = form.confirm !== form.password;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (short || mismatch) return;
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password: form.password }) });
      // Every older session has ended, including one in this browser; the next screen says so itself.
      logout();
      clearEnded();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The password was not changed. Try again.');
    } finally {
      setPending(false);
    }
  }

  const set = (key: 'password' | 'confirm') => (event: CustomEvent<{ value: string }>) => {
    const value = event.detail.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <AuthFrame>
      {preview.isLoading ? (
        <LoadingScreen label="Checking your link…" />
      ) : preview.isError || !preview.data ? (
        <AuthNotice title="Link not valid" lead="This reset link was already used or has expired. Ask for a new one.">
          <Button href="/forgot-password">Send a new link</Button>
          <Link to="/login" className="auth-link">
            Back to sign in
          </Link>
        </AuthNotice>
      ) : done ? (
        <AuthNotice title="Password changed" lead="Sign in with your new password.">
          <Button href="/login">Sign in</Button>
        </AuthNotice>
      ) : (
        <>
          <div className="auth-intro">
            <Heading level={1} size="3xl" className="auth-title">
              Choose a new password
            </Heading>
            <Text tone="muted">{`For ${preview.data.email}.`}</Text>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <form className="auth-form" onSubmit={(event) => void onSubmit(event)} noValidate>
            <TextInput
              label="New password"
              type="password"
              autocomplete="new-password"
              description="At least 10 characters"
              value={form.password}
              error={tried && short ? 'Use at least 10 characters' : ''}
              onChange={set('password')}
            />
            <TextInput
              label="Confirm password"
              type="password"
              autocomplete="new-password"
              value={form.confirm}
              error={tried && !short && mismatch ? 'Passwords do not match' : ''}
              onChange={set('confirm')}
            />
            <Button type="submit" full busy={pending} busyLabel="Saving your password">
              Save new password
            </Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}
