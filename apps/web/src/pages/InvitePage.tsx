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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await acceptInvite(token, password);
      navigate(result.kind === 'two-factor' ? '/two-factor' : homePath(result.user));
    } catch (err) {
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
                ? 'Set a password to join your importer’s desk. You will see jobs for this organisation only.'
                : 'Set a password to follow your vehicle. You will only see the job your importer assigned to you — not anyone else’s.'}
            </p>
          </div>
          <Link to="/login" className="text-sm text-mist underline-offset-4 hover:underline">
            Already have an account? Sign in
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
                <h2 className="display text-3xl">Welcome, {preview.data.firstName}</h2>
                <p className="text-sm text-ink/60">
                  {isStaffInvite
                    ? `Choose a password for ${preview.data.email}${
                        preview.data.roleLabel ? ` as ${preview.data.roleLabel}` : ''
                      }. Then you will land on the desk.`
                    : `Choose a password for ${preview.data.email}. Then you will land on your import job.`}
                </p>
                <label className="block text-sm font-semibold">
                  Password
                  <input
                    type="password"
                    className={`${fieldClass} mt-1`}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={10}
                    required
                  />
                </label>
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
                {error ? <ErrorBanner message={error} /> : null}
                <button type="submit" disabled={pending || password.length < 10} className={`${primaryBtn} w-full py-3`}>
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
