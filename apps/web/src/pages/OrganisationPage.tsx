import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INVITEABLE_STAFF_ROLES,
  ROLE_LABELS,
  type InviteableStaffRole,
  type MembershipStatus,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type UserRole,
} from '@vip/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  ErrorBanner,
  PageHeader,
  StaffPage,
  fieldClass,
  primaryBtn,
  secondaryBtn,
} from '../components/ui';

type OrganisationView = {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  brandName: string;
  timezone: string;
  currency: string;
  country: string;
  status: string;
  subscription: { plan: SubscriptionPlan; status: SubscriptionStatus; billingCycle: string } | null;
  features: Record<string, boolean>;
};

type Member = {
  id: string;
  role: UserRole;
  status: MembershipStatus;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

type InviteResult = {
  member: Member;
  inviteUrl: string;
  expiresAt: string;
};

const TIMEZONES = ['Europe/Nicosia', 'Europe/London', 'Europe/Athens', 'Europe/Berlin', 'UTC'];
const CURRENCIES = ['EUR', 'GBP', 'USD'];
const COUNTRIES = [
  { code: 'CY', label: 'Cyprus' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'GR', label: 'Greece' },
  { code: 'DE', label: 'Germany' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'IE', label: 'Ireland' },
  { code: 'MT', label: 'Malta' },
];

const STATUS_LABELS: Record<MembershipStatus, string> = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  DISABLED: 'Disabled',
};

export function OrganisationPage() {
  const hydrate = useAuth((state) => state.hydrate);
  const currentUser = useAuth((state) => state.user);
  const queryClient = useQueryClient();
  const organisation = useQuery({
    queryKey: ['organisation'],
    queryFn: () => api<OrganisationView>('/organisation'),
  });
  const members = useQuery({
    queryKey: ['organisation-members'],
    queryFn: () => api<Member[]>('/organisation/members'),
  });
  const [form, setForm] = useState({
    brandName: '',
    name: '',
    legalName: '',
    timezone: 'Europe/Nicosia',
    currency: 'EUR',
    country: 'CY',
  });
  const [inviteForm, setInviteForm] = useState({
    name: '',
    email: '',
    role: 'STAFF' as InviteableStaffRole,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  useEffect(() => {
    if (!organisation.data) return;
    setForm({
      brandName: organisation.data.brandName,
      name: organisation.data.name,
      legalName: organisation.data.legalName ?? '',
      timezone: organisation.data.timezone,
      currency: organisation.data.currency,
      country: organisation.data.country,
    });
  }, [organisation.data]);

  const save = useMutation({
    mutationFn: () => api<OrganisationView>('/organisation', { method: 'PATCH', body: JSON.stringify(form) }),
    onSuccess: async () => {
      setMessage('Workspace saved. Everyone in this organisation will see the new name.');
      await queryClient.invalidateQueries({ queryKey: ['organisation'] });
      await hydrate();
    },
  });

  const invite = useMutation({
    mutationFn: () =>
      api<InviteResult>('/organisation/members/invite', {
        method: 'POST',
        body: JSON.stringify(inviteForm),
      }),
    onSuccess: (result) => {
      setTeamError(null);
      setInviteUrl(result.inviteUrl);
      setCopied(false);
      setInviteForm({ name: '', email: '', role: 'STAFF' });
      void queryClient.invalidateQueries({ queryKey: ['organisation-members'] });
    },
    onError: (err: unknown) => {
      setTeamError(err instanceof Error ? err.message : 'Could not invite');
    },
  });

  const updateMember = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { role?: InviteableStaffRole; status?: 'ACTIVE' | 'DISABLED' };
    }) =>
      api<Member>(`/organisation/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setTeamError(null);
      void queryClient.invalidateQueries({ queryKey: ['organisation-members'] });
    },
    onError: (err: unknown) => {
      setTeamError(err instanceof Error ? err.message : 'Could not update member');
    },
  });

  const resend = useMutation({
    mutationFn: (id: string) =>
      api<InviteResult>(`/organisation/members/${id}/resend-invite`, { method: 'POST' }),
    onSuccess: (result) => {
      setTeamError(null);
      setInviteUrl(result.inviteUrl);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['organisation-members'] });
    },
    onError: (err: unknown) => {
      setTeamError(err instanceof Error ? err.message : 'Could not resend invite');
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    save.mutate();
  }

  function onInvite(event: FormEvent) {
    event.preventDefault();
    setInviteUrl(null);
    invite.mutate();
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  const org = organisation.data;

  return (
    <StaffPage>
      <PageHeader
        eyebrow="Organisation"
        title="Workspace"
        description="This is the tenant. Branding, timezone and team belong here — not in a separate copy of the software."
      />
      {org?.subscription ? (
        <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-widest">
          <span className="rounded-full bg-ink px-3 py-1 text-paper">{org.subscription.plan}</span>
          <span className="rounded-full bg-paper px-3 py-1 text-ink/70">{org.subscription.status}</span>
          {org.features.GPS_TRACKING ? (
            <span className="rounded-full bg-paper px-3 py-1 text-ink/70">GPS</span>
          ) : null}
          {org.features.CUSTOMER_PORTAL ? (
            <span className="rounded-full bg-paper px-3 py-1 text-ink/70">Customer portal</span>
          ) : null}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Card className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold sm:col-span-2">
            Workspace name
            <input
              className={`${fieldClass} mt-1`}
              value={form.brandName}
              onChange={(event) => setForm({ ...form, brandName: event.target.value })}
            />
            <span className="mt-1 block text-xs font-normal text-ink/50">
              Shown in the header and on the customer portal.
            </span>
          </label>
          <label className="block text-sm font-semibold">
            Legal name
            <input
              className={`${fieldClass} mt-1`}
              value={form.legalName}
              onChange={(event) => setForm({ ...form, legalName: event.target.value })}
            />
          </label>
          <label className="block text-sm font-semibold">
            Internal name
            <input
              className={`${fieldClass} mt-1`}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="block text-sm font-semibold">
            Timezone
            <select
              className={`${fieldClass} mt-1`}
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Currency
            <select
              className={`${fieldClass} mt-1`}
              value={form.currency}
              onChange={(event) => setForm({ ...form, currency: event.target.value })}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Country
            <select
              className={`${fieldClass} mt-1`}
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
            >
              {COUNTRIES.some((item) => item.code === form.country) ? null : (
                <option value={form.country}>{form.country}</option>
              )}
              {COUNTRIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </Card>
        {save.isError ? <ErrorBanner message={save.error instanceof Error ? save.error.message : 'Could not save'} /> : null}
        {message ? <p className="text-sm text-harbour">{message}</p> : null}
        <button type="submit" className={primaryBtn} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save workspace'}
        </button>
      </form>

      <Card>
        <h2 className="display text-2xl">Team</h2>
        <p className="mt-1 text-sm text-ink/55">
          Invite desk colleagues and set their role. Customers use portal invites from the customer record.
        </p>

        <form onSubmit={onInvite} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-semibold">
            Name
            <input
              className={`${fieldClass} mt-1`}
              value={inviteForm.name}
              onChange={(event) => setInviteForm({ ...inviteForm, name: event.target.value })}
              required
              minLength={2}
            />
          </label>
          <label className="block text-sm font-semibold">
            Email
            <input
              type="email"
              className={`${fieldClass} mt-1`}
              value={inviteForm.email}
              onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
              required
            />
          </label>
          <label className="block text-sm font-semibold">
            Role
            <select
              className={`${fieldClass} mt-1`}
              value={inviteForm.role}
              onChange={(event) =>
                setInviteForm({
                  ...inviteForm,
                  role: event.target.value as InviteableStaffRole,
                })
              }
            >
              {INVITEABLE_STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button type="submit" className={`${primaryBtn} w-full`} disabled={invite.isPending}>
              {invite.isPending ? 'Creating link…' : 'Invite'}
            </button>
          </div>
        </form>

        {teamError ? (
          <div className="mt-3">
            <ErrorBanner message={teamError} />
          </div>
        ) : null}
        {inviteUrl ? (
          <div className="mt-4 rounded-xl bg-sand px-3 py-3 text-sm">
            <p className="font-semibold">
              Copy this link now — Harbour only stores a hash of the token.
            </p>
            <p className="mt-1 break-all text-ink/70">{inviteUrl}</p>
            <button type="button" className={`${secondaryBtn} mt-3`} onClick={() => void copyLink()}>
              {copied ? 'Copied' : 'Copy invite link'}
            </button>
          </div>
        ) : null}

        <ul className="mt-6 divide-y divide-ink/10">
          {(members.data ?? []).map((member) => {
            const isSelf = member.user.id === currentUser?.id;
            const isOwner = member.role === 'OWNER';
            const canEdit = !isOwner;
            return (
              <li key={member.id} className="flex flex-col gap-3 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">
                    {member.user.name}
                    {isSelf ? <span className="ml-2 text-xs font-normal text-ink/45">(you)</span> : null}
                  </p>
                  <p className="text-ink/55">{member.user.email}</p>
                  <p className="mt-1 text-xs text-ink/45">{STATUS_LABELS[member.status]}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit ? (
                    <select
                      className={`${fieldClass} w-auto py-1.5 text-xs`}
                      value={member.role}
                      disabled={updateMember.isPending}
                      onChange={(event) =>
                        updateMember.mutate({
                          id: member.id,
                          body: { role: event.target.value as InviteableStaffRole },
                        })
                      }
                    >
                      {INVITEABLE_STAFF_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-sand px-2.5 py-1 text-[11px] font-semibold">
                      {ROLE_LABELS[member.role]}
                    </span>
                  )}
                  {canEdit && member.status === 'ACTIVE' ? (
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={updateMember.isPending || isSelf}
                      onClick={() =>
                        updateMember.mutate({ id: member.id, body: { status: 'DISABLED' } })
                      }
                    >
                      Disable
                    </button>
                  ) : null}
                  {canEdit && member.status === 'DISABLED' ? (
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={updateMember.isPending}
                      onClick={() =>
                        updateMember.mutate({ id: member.id, body: { status: 'ACTIVE' } })
                      }
                    >
                      Re-enable
                    </button>
                  ) : null}
                  {canEdit && member.status === 'INVITED' ? (
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={resend.isPending}
                      onClick={() => resend.mutate(member.id)}
                    >
                      Resend invite
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </StaffPage>
  );
}
