import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { JobStatus } from '@vip/shared';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { Card, ErrorBanner, LoadingScreen, PageHeader, StaffPage, fieldClass, primaryBtn, secondaryBtn } from '../components/ui';
import { useSession } from '../lib/session';

type PortalAccess = {
  status: 'NONE' | 'INVITED' | 'ACTIVE';
  email: string | null;
  invitedAt: string | null;
  expiresAt: string | null;
};

type CustomerDetail = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  portal: PortalAccess;
  importJobs: {
    id: string;
    reference: string;
    status: JobStatus;
    expectedDeliveryDate: string | null;
    vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
  }[];
};

const PORTAL_COPY: Record<PortalAccess['status'], { title: string; body: string; action: string }> = {
  NONE: {
    title: 'No portal access',
    body: 'Invite them with the email on this record. Harbour logs the link until a real mail adapter is wired.',
    action: 'Invite to portal',
  },
  INVITED: {
    title: 'Invite sent',
    body: 'They have not set a password yet. Resend if the previous link was lost — the raw token is not stored.',
    action: 'Resend invite',
  },
  ACTIVE: {
    title: 'Portal active',
    body: 'They can sign in. Send a new link only if they need to set a fresh password.',
    action: 'Send password reset link',
  },
};

export function CustomerDetailPage() {
  const { canWrite } = useSession();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api<CustomerDetail>(`/customers/${id}`),
    enabled: Boolean(id),
  });
  const customer = query.data;
  const [form, setForm] = useState<Pick<CustomerDetail, 'firstName' | 'lastName' | 'email' | 'phone' | 'address' | 'notes'> | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const values = form ?? (customer
    ? {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        address: customer.address ?? '',
        notes: customer.notes ?? '',
      }
    : null);

  const save = useMutation({
    mutationFn: () =>
      api(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...values,
          email: values?.email || undefined,
        }),
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['customer', id] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not save');
    },
  });

  const invite = useMutation({
    mutationFn: () => api<CustomerDetail & { inviteUrl: string }>(`/customers/${id}/invite`, { method: 'POST' }),
    onSuccess: (result) => {
      setError(null);
      setInviteUrl(result.inviteUrl);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['customer', id] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    },
  });

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  if (query.isLoading) return <LoadingScreen label="Loading customer…" />;
  if (query.isError || !customer || !values) {
    return (
      <ErrorBanner
        message={query.error instanceof ApiError ? query.error.message : 'Could not load this customer.'}
      />
    );
  }

  const copy = PORTAL_COPY[customer.portal.status];

  return (
    <StaffPage>
      <Link to="/customers" className="text-sm font-semibold text-harbour">
        ← All customers
      </Link>
      <PageHeader
        eyebrow="Customer"
        title={`${customer.firstName} ${customer.lastName}`}
        description={customer.email ?? 'No email yet'}
      />
      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <h2 className="display text-2xl">Portal</h2>
        <p className="mt-1 text-sm font-semibold">{copy.title}</p>
        <p className="text-sm text-ink/60">
          {canWrite ? copy.body : 'Portal access is managed by staff in this organisation.'}
        </p>
        {customer.portal.expiresAt && customer.portal.status === 'INVITED' ? (
          <p className="mt-2 text-xs text-ink/45">Expires {formatDate(customer.portal.expiresAt)}</p>
        ) : null}
        {canWrite ? (
        <button
          type="button"
          className={`${primaryBtn} mt-4`}
          disabled={invite.isPending || !customer.email}
          onClick={() => invite.mutate()}
        >
          {invite.isPending ? 'Creating link…' : copy.action}
        </button>
        ) : null}
        {inviteUrl ? (
          <div className="mt-4 rounded-xl bg-sand px-3 py-3 text-sm">
            <p className="font-semibold">Copy this link now. Harbour only stores a hash of the token.</p>
            <p className="mt-1 break-all text-ink/70">{inviteUrl}</p>
            <button type="button" className={`${secondaryBtn} mt-3`} onClick={() => void copyLink()}>
              {copied ? 'Copied' : 'Copy invite link'}
            </button>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="display text-2xl">Contact</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={fieldClass} disabled={!canWrite} value={values.firstName} onChange={(event) => setForm({ ...values, firstName: event.target.value })} placeholder="First name" />
          <input className={fieldClass} disabled={!canWrite} value={values.lastName} onChange={(event) => setForm({ ...values, lastName: event.target.value })} placeholder="Last name" />
          <input className={fieldClass} disabled={!canWrite} value={values.email} onChange={(event) => setForm({ ...values, email: event.target.value })} placeholder="Email" />
          <input className={fieldClass} disabled={!canWrite} value={values.phone} onChange={(event) => setForm({ ...values, phone: event.target.value })} placeholder="Phone" />
          <input className={`${fieldClass} sm:col-span-2`} disabled={!canWrite} value={values.address} onChange={(event) => setForm({ ...values, address: event.target.value })} placeholder="Address" />
          <textarea className={`${fieldClass} min-h-24 sm:col-span-2`} disabled={!canWrite} value={values.notes} onChange={(event) => setForm({ ...values, notes: event.target.value })} placeholder="Internal notes — never shown in the portal" />
        </div>
        {canWrite ? (
        <button
          type="button"
          className={`${primaryBtn} mt-3`}
          disabled={!values.firstName || !values.lastName || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        ) : null}
      </Card>

      <Card>
        <h2 className="display text-2xl">Import jobs</h2>
        {customer.importJobs.length === 0 ? (
          <p className="mt-2 text-sm text-ink/50">No jobs for this customer yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {customer.importJobs.map((job) => (
              <li key={job.id}>
                <Link to={`/jobs/${job.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-sand/70 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{job.reference}</span>
                    <span className="block text-ink/55">
                      {job.vehicle.make} {job.vehicle.model}
                      {job.vehicle.ukRegistration ? ` · ${job.vehicle.ukRegistration}` : ''}
                    </span>
                  </span>
                  <StatusBadge status={job.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StaffPage>
  );
}
