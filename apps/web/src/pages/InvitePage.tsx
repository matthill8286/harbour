import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import type { UserRole } from '@vip/shared';
import { api } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame, AuthNotice } from '../components/AuthFrame';
import { LoadingScreen } from '../components/ui';

type InvitePreview = {
  kind?: 'portal' | 'staff';
  email: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  roleLabel?: string;
  organisationName: string;
  organisationBrandName?: string;
  expiresAt: string;
};

/**
 * Accepting an invite, after the Figma frames "Auth · Invite": a customer
 * activates their portal, a team member joins the desk. Both choose a password.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { acceptInvite } = useAuth();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) return <Navigate to="/login" replace />;

  const invite = preview.data;
  const team = invite?.kind === 'staff';
  const importer = invite ? invite.organisationBrandName || invite.organisationName : '';
  const short = form.password.length < 10;
  const mismatch = form.confirm !== form.password;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (short || mismatch) return;
    setPending(true);
    setError(null);
    try {
      const result = await acceptInvite(token, form.password);
      navigate(result.kind === 'two-factor' ? '/two-factor' : homePath(result.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This invite could not be accepted. Try again.');
    } finally {
      setPending(false);
    }
  }

  const set = (key: 'password' | 'confirm') => (event: CustomEvent<{ value: string }>) => {
    const value = event.detail.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <AuthFrame
      importer={invite && !team ? { name: importer, caption: 'Customer portal' } : undefined}
      headline={invite && !team ? 'Follow your car from collection to handover.' : undefined}
      lead={invite && !team ? 'Photos, documents and updates your importer shares with you.' : undefined}
    >
      {preview.isLoading ? (
        <LoadingScreen label="Checking your invite…" />
      ) : preview.isError || !invite ? (
        <AuthNotice
          title="Invite unavailable"
          lead="This invite is not valid. It was already used or has expired. Ask the person who invited you for a new link."
        >
          <Button href="/login">Go to sign in</Button>
        </AuthNotice>
      ) : (
        <>
          <div className="auth-intro">
            <Badge>{team ? 'Team access' : 'Customer portal'}</Badge>
            <Heading level={1} size="3xl" className="auth-title">
              {team ? `Join ${importer}` : 'Activate your portal'}
            </Heading>
            <Text tone="muted">
              {team
                ? `Set a password to join the desk${invite.roleLabel ? ` as ${invite.roleLabel}` : ''}. You will see this workspace's jobs only.`
                : 'Set a password to follow your vehicle. You will only see your own imports.'}
            </Text>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <form className="auth-form" onSubmit={(event) => void onSubmit(event)} noValidate>
            <TextInput label="Email" type="email" autocomplete="username" value={invite.email} disabled />
            <TextInput
              label="Password"
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
              placeholder="Repeat your password"
              value={form.confirm}
              error={tried && !short && mismatch ? 'Passwords do not match' : ''}
              onChange={set('confirm')}
            />
            <Button type="submit" full busy={pending} busyLabel={team ? 'Joining the desk' : 'Activating your portal'}>
              {team ? 'Join the team' : 'Activate portal'}
            </Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}
