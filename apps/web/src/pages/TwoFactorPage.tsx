import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';

/**
 * The second step of sign-in for accounts with two-factor on, after the Figma
 * frames "Auth · Two-factor": a code from the authenticator app, or a backup code.
 * One field rather than six boxes, so pasting and the phone's code autofill work.
 */
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
    if (!value.trim()) return;
    setPending(true);
    setError(null);
    try {
      const signedIn = await completeChallenge(useBackup ? { backupCode: value.trim() } : { code: value.replace(/\s/g, '') });
      navigate(homePath(signedIn));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is not right.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame>
      <div className="auth-intro">
        <Heading level={1} size="3xl" className="auth-title">
          Enter your code
        </Heading>
        <Text tone="muted">
          {useBackup
            ? 'Enter one of the backup codes you saved when you set up two-factor sign-in. Each code works once.'
            : 'Open your authenticator app and enter the 6-digit code for Harbour.'}
        </Text>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form className="auth-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextInput
          key={useBackup ? 'backup' : 'code'}
          label={useBackup ? 'Backup code' : 'Authenticator code'}
          inputmode={useBackup ? 'text' : 'numeric'}
          autocomplete="one-time-code"
          placeholder={useBackup ? 'abcde-12345' : '123 456'}
          value={value}
          onChange={(event) => {
            const next = event.detail.value;
            setValue(next);
          }}
        />
        <Button type="submit" full busy={pending} busyLabel="Checking the code">
          Continue
        </Button>
      </form>
      <button
        type="button"
        className="auth-link auth-switch"
        onClick={() => {
          setUseBackup((b) => !b);
          setValue('');
          setError(null);
        }}
      >
        {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
      </button>
    </AuthFrame>
  );
}
