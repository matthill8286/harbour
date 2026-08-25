import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, type MembershipStatus, type SubscriptionPlan, type SubscriptionStatus, type UserRole } from '@vip/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, ErrorBanner, PageHeader, fieldClass, primaryBtn } from '../components/ui';

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

export function OrganisationPage() {
  const hydrate = useAuth((state) => state.hydrate);
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
  const [message, setMessage] = useState<string | null>(null);

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

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    save.mutate();
  }

  const org = organisation.data;

  return (
    <div className="space-y-6">
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
        <p className="mt-1 text-sm text-ink/55">Internal members of this organisation. End customers are not listed here.</p>
        <ul className="mt-4 divide-y divide-ink/10">
          {(members.data ?? []).map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-semibold">{member.user.name}</p>
                <p className="text-ink/55">{member.user.email}</p>
              </div>
              <span className="rounded-full bg-sand px-2.5 py-1 text-[11px] font-semibold">
                {ROLE_LABELS[member.role]}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
