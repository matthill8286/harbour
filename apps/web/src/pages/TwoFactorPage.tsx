import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner, fieldClass, primaryBtn } from '../components/ui';

/** Second step of sign-in for accounts with two-factor on. */
export function TwoFactorPage() {
  const { user, challenge, completeChallenge } = useAuth();
  const navigate = useNavigate();
  const [useBackup, setUseBackup] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={homePath(user)} replace />;
  if (!challenge) return <Navigate to="/login" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const signedIn = await completeChallenge(
        useBackup ? { backupCode: value.trim() } : { code: value.replace(/\s/g, '') },
      );
      navigate(homePath(signedIn));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is not right.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="Two-factor sign-in"
      lead="Your account is protected with an authenticator app. Enter the code it shows to finish signing in."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <h2 className="display text-3xl">Enter your code</h2>
        <p className="text-sm text-ink/60">
          {useBackup
            ? 'Enter one of the backup codes you saved when you set up two-factor sign-in. Each code works once.'
            : 'Open your authenticator app and enter the 6-digit code for Harbour.'}
        </p>
        <label className="block text-sm font-semibold">
          {useBackup ? 'Backup code' : 'Authenticator code'}
          <input
            key={useBackup ? 'backup' : 'code'}
            className={`${fieldClass} mt-1 font-mono tracking-widest`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode={useBackup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            pattern={useBackup ? undefined : '[0-9 ]{6,7}'}
            placeholder={useBackup ? 'abcde-12345' : '123 456'}
            required
            autoFocus
          />
        </label>
        {error ? <ErrorBanner message={error} /> : null}
        <button type="submit" disabled={pending} className={`${primaryBtn} w-full py-3`}>
          {pending ? 'Checking…' : 'Verify'}
        </button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="font-semibold text-harbour"
            onClick={() => {
              setUseBackup((current) => !current);
              setValue('');
              setError(null);
            }}
          >
            {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
          </button>
          <Link to="/login" className="text-ink/60">
            Start again
          </Link>
        </div>
      </form>
    </AuthFrame>
  );
}
