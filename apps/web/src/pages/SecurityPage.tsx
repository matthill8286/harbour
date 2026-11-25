import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isStaffRole } from '@vip/shared';
import { api, type TwoFactorStatus } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { BackupCodeList } from '../components/BackupCodeList';
import { TwoFactorEnrolment } from '../components/TwoFactorEnrolment';
import {
  Card,
  ErrorBanner,
  fieldClass,
  LoadingScreen,
  PageHeader,
  primaryBtn,
  secondaryBtn,
  StaffPage,
} from '../components/ui';

const STATUS_KEY = ['two-factor-status'];

/** Two-factor status, fresh backup codes and switching it off. */
export function SecurityPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api<TwoFactorStatus>('/auth/two-factor'),
  });

  async function reload() {
    const updated = await refresh();
    await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    return updated;
  }

  return (
    <StaffPage>
      <PageHeader
        eyebrow="Account"
        title="Security"
        description="Two-factor sign-in asks for a code from your phone as well as your password."
      />
      <div className="mt-6 space-y-4">
        {status.isLoading ? <LoadingScreen /> : null}
        {status.error ? <ErrorBanner message={status.error.message} /> : null}
        {status.data && !status.data.enabled ? (
          <Card className="space-y-4">
            <div>
              <h2 className="font-semibold">Two-factor sign-in is off</h2>
              <p className="text-sm text-ink/60">
                Turn it on to protect your account if your password leaks.
              </p>
            </div>
            <TwoFactorEnrolment onEnabled={() => void reload()} />
          </Card>
        ) : null}
        {status.data?.enabled ? (
          <>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Two-factor sign-in is on</h2>
                <p className="text-sm text-ink/60">
                  {status.data.backupCodesRemaining} of 10 backup codes left.
                </p>
              </div>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                Protected
              </span>
            </Card>
            <RegenerateCodes onDone={() => void reload()} />
            <DisableTwoFactor
              staff={user ? isStaffRole(user.role) : false}
              onDone={async () => {
                const updated = await reload();
                if (updated) navigate(homePath(updated), { replace: true });
              }}
            />
          </>
        ) : null}
      </div>
    </StaffPage>
  );
}

function PasswordForm({
  label,
  submitLabel,
  danger = false,
  onSubmit,
}: {
  label: string;
  submitLabel: string;
  danger?: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-semibold">
        {label}
        <input
          type="password"
          className={`${fieldClass} mt-1`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error ? <ErrorBanner message={error} /> : null}
      <button
        type="submit"
        disabled={pending}
        className={danger ? `${secondaryBtn} text-red-700` : primaryBtn}
      >
        {pending ? 'Working…' : submitLabel}
      </button>
    </form>
  );
}

function RegenerateCodes({ onDone }: { onDone: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">Backup codes</h2>
        <p className="text-sm text-ink/60">
          New codes replace the old ones straight away. Save them before you leave this page.
        </p>
      </div>
      {codes ? <BackupCodeList codes={codes} /> : null}
      <PasswordForm
        label="Confirm your password"
        submitLabel="Make new backup codes"
        onSubmit={async (password) => {
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

function DisableTwoFactor({ staff, onDone }: { staff: boolean; onDone: () => Promise<void> }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">Turn off two-factor sign-in</h2>
        <p className="text-sm text-ink/60">
          {staff
            ? 'Team members must use two-factor sign-in, so you will be asked to set it up again straight away, for example on a new phone.'
            : 'Your account will only be protected by your password.'}
        </p>
      </div>
      <PasswordForm
        label="Confirm your password"
        submitLabel="Turn off"
        danger
        onSubmit={async (password) => {
          await api('/auth/two-factor/disable', {
            method: 'POST',
            body: JSON.stringify({ password }),
          });
          await onDone();
        }}
      />
    </Card>
  );
}
