import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { UserRole } from '@vip/shared';
import { api, ApiError } from '../lib/api';
import { homePath, useAuth } from '../lib/auth';
import { ErrorBanner, fieldClass, primaryBtn } from '../components/ui';

type InvitePreview = {
  kind?: 'portal' | 'staff';
  email: string;
  /** The email already has a Harbour password, which accepting must prove. */
  existingAccount?: boolean;
  firstName: string;
  lastName: string;
  role?: UserRole;
  roleLabel?: string;
  organisationName: string;
  organisationBrandName?: string;
  expiresAt: string;
};

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const acceptInvite = useAuth((state) => state.acceptInvite);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [codeNeeded, setCodeNeeded] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) return <Navigate to="/login" replace />;

  const isStaffInvite = preview.data?.kind === 'staff';
  const existing = preview.data?.existingAccount ?? false;
  const organisation = preview.data?.organisationBrandName ?? preview.data?.organisationName;
  const ready = existing ? password.length > 0 && (!codeNeeded || code.trim().length > 0) : password.length >= 10;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!existing && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const secondStep = codeNeeded ? (useBackup ? { backupCode: code.trim() } : { code: code.replace(/\s/g, '') }) : undefined;
      const result = await acceptInvite(token, password, secondStep);
      navigate(result.kind === 'two-factor' ? '/two-factor' : homePath(result.user));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invite_two_factor_required') {
        setCodeNeeded(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not activate this invite');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-svh bg-ink text-paper">
      <div className="mx-auto grid min-h-svh max-w-5xl md:grid-cols-2">
        <section className="hidden flex-col justify-between p-10 md:flex">
          <p className="text-xs uppercase tracking-[0.28em] text-mist">{isStaffInvite ? 'Team access' : 'Customer portal'}</p>
          <div>
            <h1 className="display text-5xl leading-tight">Harbour</h1>
            <p className="mt-4 max-w-sm text-mist">
              {isStaffInvite
                ? `${existing ? 'Confirm your password' : 'Set a password'} to join your importer’s desk. You will see jobs for this organisation only.`
                : `${existing ? 'Confirm your password' : 'Set a password'} to follow your vehicle. You will only see the job your importer assigned to you — not anyone else’s.`}
            </p>
          </div>
          <Link to="/login" className="text-sm text-mist underline-offset-4 hover:underline">
            Go to sign in
          </Link>
        </section>
        <section className="flex items-center bg-sand p-6 text-ink md:p-12">
          <div className="w-full max-w-md space-y-4">
            {preview.isLoading ? <p className="text-sm text-ink/55">Checking invite…</p> : null}
            {preview.isError ? (
              <div className="space-y-3">
                <h2 className="display text-3xl">Invite unavailable</h2>
                <ErrorBanner message={preview.error instanceof ApiError ? preview.error.message : 'This invite is not valid.'} />
                <Link to="/login" className="text-sm font-semibold text-harbour">
                  Go to sign in
                </Link>
              </div>
            ) : null}
            {preview.data ? (
              <form onSubmit={onSubmit} className="space-y-4">
                <p className="text-xs uppercase tracking-widest text-harbour">{preview.data.organisationBrandName ?? preview.data.organisationName}</p>
                <h2 className="display text-3xl">{preview.data.firstName ? `Welcome, ${preview.data.firstName}` : 'Welcome back'}</h2>
                {existing ? (
                  <p className="text-sm text-ink/60">
                    {`${preview.data.email} already has a Harbour account. Enter the password you sign in with to ${
                      isStaffInvite
                        ? `join ${organisation}${preview.data.roleLabel ? ` as ${preview.data.roleLabel}` : ''}`
                        : `open your portal with ${organisation}`
                    }. Your password and name stay as they are.`}
                  </p>
                ) : (
                  <p className="text-sm text-ink/60">
                    {isStaffInvite
                      ? `Choose a password for ${preview.data.email}${
                          preview.data.roleLabel ? ` as ${preview.data.roleLabel}` : ''
                        }. Then you will land on the desk.`
                      : `Choose a password for ${preview.data.email}. Then you will land on your import job.`}
                  </p>
                )}
                <label className="block text-sm font-semibold">
                  Password
                  <input
                    type="password"
                    className={`${fieldClass} mt-1`}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={existing ? 'current-password' : 'new-password'}
                    minLength={existing ? undefined : 10}
                    required
                  />
                </label>
                {existing ? (
                  <Link to="/forgot-password" className="block text-sm font-semibold text-harbour">
                    Forgot your password? Reset it, then open this link again
                  </Link>
                ) : (
                  <label className="block text-sm font-semibold">
                    Confirm password
                    <input
                      type="password"
                      className={`${fieldClass} mt-1`}
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      autoComplete="new-password"
                      minLength={10}
                      required
                    />
                  </label>
                )}
                {codeNeeded ? (
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold">
                      {useBackup ? 'Backup code' : 'Authenticator code'}
                      <input
                        key={useBackup ? 'backup' : 'code'}
                        className={`${fieldClass} mt-1 font-mono tracking-widest`}
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        inputMode={useBackup ? 'text' : 'numeric'}
                        autoComplete="one-time-code"
                        placeholder={useBackup ? 'abcde-12345' : '123 456'}
                        required
                        autoFocus
                      />
                    </label>
                    <button
                      type="button"
                      className="text-sm font-semibold text-harbour"
                      onClick={() => {
                        setUseBackup((current) => !current);
                        setCode('');
                        setError(null);
                      }}
                    >
                      {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
                    </button>
                  </div>
                ) : null}
                {error ? <ErrorBanner message={error} /> : null}
                <button type="submit" disabled={pending || !ready} className={`${primaryBtn} w-full py-3`}>
                  {pending ? (isStaffInvite ? 'Opening desk…' : 'Opening portal…') : isStaffInvite ? 'Join team' : 'Activate portal'}
                </button>
              </form>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
