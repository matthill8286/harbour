import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner, fieldClass, primaryBtn } from '../components/ui';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame eyebrow="Password reset" lead="Enter the email you sign in with and we will send you a link to choose a new password.">
      {sent ? (
        <div className="space-y-4">
          <h2 className="display text-3xl">Check your email</h2>
          <p className="text-sm text-ink/60">If {email.trim()} has a Harbour account, a reset link is on its way. The link works for one hour.</p>
          <Link to="/login" className={`${primaryBtn} w-full py-3`}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="display text-3xl">Forgot your password?</h2>
          <label className="block text-sm font-semibold">
            Email
            <input
              type="email"
              className={`${fieldClass} mt-1`}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </label>
          {error ? <ErrorBanner message={error} /> : null}
          <button type="submit" disabled={pending} className={`${primaryBtn} w-full py-3`}>
            {pending ? 'Sending…' : 'Send reset link'}
          </button>
          <Link to="/login" className="block text-sm text-ink/60">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthFrame>
  );
}
