import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { api, type SessionResponse } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';

type Form = { organisationName: string; name: string; email: string; password: string; confirm: string };
const BLANK: Form = { organisationName: '', name: '', email: '', password: '', confirm: '' };

/**
 * Self-serve sign-up, after the Figma frame "Auth · Sign-up": a new importer
 * gets their own workspace on a trial, as its Admin.
 */
export function SignupPage() {
  const { user, ready, adopt } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(BLANK);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && user) return <Navigate to={homePath(user)} replace />;

  const problems = {
    organisationName: form.organisationName.trim() ? '' : 'Enter your company name',
    name: form.name.trim().length >= 2 ? '' : 'Enter your name',
    email: /^\S+@\S+\.\S+$/.test(form.email.trim()) ? '' : 'Enter an email like name@company.com',
    password: form.password.length >= 10 ? '' : 'Use at least 10 characters',
    confirm: form.confirm === form.password ? '' : 'Passwords do not match',
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    setPending(true);
    setError(null);
    try {
      const result = await api<SessionResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ organisationName: form.organisationName.trim(), name: form.name.trim(), email: form.email.trim(), password: form.password }),
      });
      adopt(result);
      navigate(homePath(result.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your workspace was not created. Try again.');
    } finally {
      setPending(false);
    }
  }

  const field = (key: keyof Form) => ({
    value: form[key],
    error: tried ? problems[key] : '',
    onChange: (event: CustomEvent<{ value: string }>) => {
      const value = event.detail.value;
      setForm((f) => ({ ...f, [key]: value }));
    },
  });

  return (
    <AuthFrame>
      <div className="auth-intro">
        <Badge>Start a free trial</Badge>
        <Heading level={1} size="3xl" className="auth-title">
          Create your workspace
        </Heading>
        <Text tone="muted">Your data stays inside your own workspace.</Text>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form className="auth-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextInput label="Company name" autocomplete="organization" {...field('organisationName')} />
        <div className="auth-pair">
          <TextInput label="Your name" autocomplete="name" {...field('name')} />
          <TextInput label="Work email" type="email" autocomplete="email" {...field('email')} />
        </div>
        <TextInput label="Password" type="password" autocomplete="new-password" description="At least 10 characters" {...field('password')} />
        <TextInput label="Confirm password" type="password" autocomplete="new-password" {...field('confirm')} />
        <Button type="submit" full busy={pending} busyLabel="Creating your workspace">
          Create workspace
        </Button>
      </form>
      <p className="auth-aside">
        Already have a workspace?{' '}
        <Link to="/login" className="auth-link">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
