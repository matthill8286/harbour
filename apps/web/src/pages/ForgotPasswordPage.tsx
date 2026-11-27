import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { api } from '../lib/api';
import { AuthFrame, AuthNotice } from '../components/AuthFrame';

/** Asks for a reset link, after the Figma frames "Auth · Forgot password". */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter the email you sign in with.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The reset email was not sent. Try again.');
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <AuthFrame>
        <AuthNotice title="Check your email" lead={`If an account exists for ${email.trim()}, a reset link is on its way. The link works once.`}>
          <Link to="/login" className="auth-link">
            Back to sign in
          </Link>
        </AuthNotice>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className="auth-intro">
        <Heading level={1} size="3xl" className="auth-title">
          Forgot your password?
        </Heading>
        <Text tone="muted">Enter your email and we will send a link to choose a new one.</Text>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form className="auth-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextInput
          label="Email"
          type="email"
          autocomplete="username"
          placeholder="name@company.com"
          value={email}
          onChange={(event) => {
            const value = event.detail.value;
            setEmail(value);
          }}
        />
        <Button type="submit" full busy={pending} busyLabel="Sending the link">
          Send reset link
        </Button>
      </form>
      <Link to="/login" className="auth-link">
        Back to sign in
      </Link>
    </AuthFrame>
  );
}
