import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar, Badge, Button, Card, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { isStaffRole, type PublicUser } from '@vip/shared';
import { api, type SessionResponse, type TwoFactorStatus } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { useSession } from '../lib/session';
import { BackupCodeList } from '../components/BackupCodeList';
import { TwoFactorEnrolment } from '../components/TwoFactorEnrolment';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import { SignOutDialog } from './account/SignOutDialog';
import './account/Account.css';

const STATUS_KEY = ['two-factor-status'];
/** How many backup codes a fresh set has. */
const BACKUP_CODES = 10;

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

/** A password field and a button, for the actions that need the password confirmed first. */
function ConfirmPassword({
  submitLabel,
  busyLabel,
  variant = 'secondary',
  onConfirm,
}: {
  submitLabel: string;
  busyLabel: string;
  variant?: 'primary' | 'secondary';
  onConfirm: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(password);
      setPassword('');
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="account-confirm" onSubmit={(event) => void submit(event)}>
      <TextInput
        type="password"
        label="Confirm your password"
        autocomplete="current-password"
        value={password}
        error={error ?? ''}
        onChange={(event) => {
          const value = event.detail.value;
          setPassword(value);
        }}
      />
      <Button type="submit" variant={variant} disabled={!password} busy={pending} busyLabel={busyLabel}>
        {submitLabel}
      </Button>
    </form>
  );
}

function CardHead({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <div className="account-card-head">
      <div>
        <Heading level={2} size="md">
          {title}
        </Heading>
        {lead ? (
          <Text size="sm" tone="muted">
            {lead}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Profile({ user }: { user: PublicUser }) {
  const setUser = useAuth((state) => state.setUser);
  const { roleLabel, workspace } = useSession();
  const [name, setName] = useState<string | null>(null);
  const value = name ?? user.name;
  const save = useMutation({
    mutationFn: () =>
      api<PublicUser>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: value.trim() }),
      }),
    onSuccess: (updated) => {
      setUser(updated);
      setName(null);
    },
  });
  const changed = name !== null && name.trim() !== user.name;

  return (
    <Card className="account-card">
      <div className="account-who">
        <Avatar fullName={user.name} size="lg" />
        <div>
          <Heading level={2} size="xl">
            {user.name}
          </Heading>
          <div className="account-who-meta">
            <Badge tone="inverse">{roleLabel}</Badge>
            <Text size="sm">{workspace}</Text>
          </div>
        </div>
      </div>
      <form
        className="account-profile"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && value.trim().length >= 2) save.mutate();
        }}
      >
        <TextInput
          label="Full name"
          autocomplete="name"
          value={value}
          error={name !== null && name.trim().length < 2 ? 'Enter your full name' : ''}
          onChange={(event) => {
            const next = event.detail.value;
            setName(next);
          }}
        />
        <TextInput label="Email, used to sign in" type="email" value={user.email} disabled />
        <TextInput label="Workspace" value={workspace} disabled className="account-wide" />
        {save.isError ? (
          <Alert tone="danger" heading="Your name was not saved" className="account-wide">
            {message(save.error)}
          </Alert>
        ) : null}
        <div className="account-wide account-actions">
          {save.isSuccess && !changed ? (
            <Text size="sm" tone="muted">
              Saved.
            </Text>
          ) : null}
          <Button type="submit" disabled={!changed || value.trim().length < 2} busy={save.isPending} busyLabel="Saving your name">
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Password({ email }: { email: string }) {
  const adopt = useAuth((state) => state.adopt);
  const [form, setForm] = useState({ current: '', next: '' });
  const [resetSent, setResetSent] = useState(false);
  const change = useMutation({
    mutationFn: () =>
      api<SessionResponse>('/auth/password/change', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: form.current,
          newPassword: form.next,
        }),
      }),
    onSuccess: (session) => {
      adopt(session);
      setForm({ current: '', next: '' });
    },
  });
  const reset = useMutation({
    mutationFn: () =>
      api('/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => setResetSent(true),
  });
  const tooShort = form.next.length > 0 && form.next.length < 10;

  return (
    <Card className="account-card">
      <CardHead title="Password" />
      <form
        className="account-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (form.current && form.next.length >= 10) change.mutate();
        }}
      >
        <TextInput
          type="password"
          label="Current password"
          autocomplete="current-password"
          value={form.current}
          onChange={(event) => {
            const value = event.detail.value;
            setForm((f) => ({ ...f, current: value }));
          }}
        />
        <TextInput
          type="password"
          label="New password, at least 10 characters"
          autocomplete="new-password"
          value={form.next}
          error={tooShort ? 'Use at least 10 characters' : ''}
          onChange={(event) => {
            const value = event.detail.value;
            setForm((f) => ({ ...f, next: value }));
          }}
        />
        {change.isError ? (
          <Alert tone="danger" heading="Your password was not changed">
            {message(change.error)}
          </Alert>
        ) : null}
        {change.isSuccess ? (
          <Alert tone="success" heading="Password changed">
            Every other device has been signed out. This one stays signed in.
          </Alert>
        ) : null}
        <div className="account-actions is-split">
          {resetSent ? (
            <Text size="sm" tone="muted">{`We sent a reset link to ${email}.`}</Text>
          ) : (
            <Button variant="ghost" size="sm" busy={reset.isPending} busyLabel="Sending the link" onClick={() => reset.mutate()}>
              Forgot it? Send a reset link
            </Button>
          )}
          <Button
            type="submit"
            variant="secondary"
            disabled={!form.current || form.next.length < 10}
            busy={change.isPending}
            busyLabel="Changing your password"
          >
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BackupCodes({ remaining, onDone }: { remaining: number; onDone: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <Card className="account-card">
      <CardHead title="Backup codes" lead="Each code works once if you lose your phone. Keep them somewhere safe.">
        <Badge>{`${remaining} of ${BACKUP_CODES} left`}</Badge>
      </CardHead>
      {codes ? (
        <>
          <Alert tone="warning" heading="Save these now">
            They replace your old codes, and Harbour cannot show them again.
          </Alert>
          <BackupCodeList codes={codes} />
        </>
      ) : (
        <Text size="sm" tone="muted" className="account-note">
          Harbour keeps your codes locked away and cannot show them again. Make a new set if you have lost yours; the old ones stop working.
        </Text>
      )}
      <ConfirmPassword
        submitLabel="New codes"
        busyLabel="Making new codes"
        onConfirm={async (password) => {
          const result = await api<{ backupCodes: string[] }>('/auth/two-factor/backup-codes', {
            method: 'POST',
            body: JSON.stringify({ password }),
          });
          setCodes(result.backupCodes);
          onDone();
        }}
      />
    </Card>
  );
}

/**
 * Account and security, after the Figma frame "Business · Account and security":
 * profile, password, two-factor sign-in, backup codes and signing out.
 */
export function SecurityPage() {
  const { user, refresh } = useAuth();
  const { roleLabel } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api<TwoFactorStatus>('/auth/two-factor'),
  });
  const staff = user ? isStaffRole(user.role) : false;

  async function reload() {
    const updated = await refresh();
    await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    return updated;
  }

  if (!user) return null;

  return (
    <div className="account">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          Account
        </Heading>
        <Text size="sm">{`${user.name} · ${roleLabel}`}</Text>
      </PhoneHeader>

      <div className="account-heading">
        <Heading level={1} size="4xl">
          Account and security
        </Heading>
        <Text tone="muted">Your profile, password, two-factor sign-in and sign-out.</Text>
      </div>

      <div className="account-grid">
        <div className="account-column">
          <Profile user={user} />
          {status.isLoading ? (
            <LoadingScreen label="Loading two-factor sign-in…" />
          ) : status.isError || !status.data ? (
            <Alert tone="danger" heading="Two-factor status could not load">
              Check your connection, then reload the page.
            </Alert>
          ) : status.data.enabled ? (
            <>
              <Card className="account-card">
                <CardHead title="Two-factor sign-in is on" lead="Codes come from the authenticator app on your phone.">
                  <Badge tone="solid">On</Badge>
                </CardHead>
              </Card>
              <Card className="account-card">
                <CardHead
                  title="Turn off two-factor sign-in"
                  lead={
                    staff
                      ? 'Team members must use it, so you will set it up again straight away. Use this to move it to a new phone.'
                      : 'Your account will only be protected by your password.'
                  }
                />
                <ConfirmPassword
                  submitLabel="Turn off"
                  busyLabel="Turning it off"
                  onConfirm={async (password) => {
                    await api('/auth/two-factor/disable', {
                      method: 'POST',
                      body: JSON.stringify({ password }),
                    });
                    const updated = await reload();
                    if (updated) navigate(homePath(updated), { replace: true });
                  }}
                />
              </Card>
            </>
          ) : (
            <Card className="account-card">
              <CardHead title="Two-factor sign-in is off" lead="Turn it on to protect your account if your password leaks.">
                <Badge>Off</Badge>
              </CardHead>
              <TwoFactorEnrolment onEnabled={() => void reload()} />
            </Card>
          )}
        </div>

        <div className="account-column">
          <Password email={user.email} />
          <Card className="account-card">
            <CardHead title="Sign out" lead="Ends your session on this device.">
              <Button variant="secondary" iconBefore="log-out" onClick={() => setSigningOut(true)}>
                Sign out
              </Button>
            </CardHead>
          </Card>
          {status.data?.enabled ? <BackupCodes remaining={status.data.backupCodesRemaining} onDone={() => void reload()} /> : null}
        </div>
      </div>

      {signingOut ? <SignOutDialog onClose={() => setSigningOut(false)} /> : null}
    </div>
  );
}
