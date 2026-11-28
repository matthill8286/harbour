import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar, Badge, Button, Card, Heading, Row, Select, Text, TextInput } from '@atomic-ui/ui-react';
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
import { useRoutes } from './routes/routes';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import { InviteOutcome, type InviteDelivery } from '../components/InviteOutcome';
import { GpsSettings } from './account/GpsSettings';
import { AgreementsCard } from '../components/Agreements';
import './account/Account.css';

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
  subscription: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    billingCycle: string;
  } | null;
  features: Record<string, boolean>;
};

type Member = {
  id: string;
  role: UserRole;
  status: MembershipStatus;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

type InviteResult = InviteDelivery & { member: Member; expiresAt: string };

type Settings = Pick<OrganisationView, 'legalName' | 'brandName' | 'timezone' | 'currency' | 'country'>;

const TIMEZONES = ['Europe/Nicosia', 'Europe/London', 'Europe/Athens', 'Europe/Berlin', 'UTC'].map((zone) => ({ value: zone, label: zone }));
const CURRENCIES = [
  { value: 'EUR', label: 'EUR · Euro' },
  { value: 'GBP', label: 'GBP · Pound sterling' },
  { value: 'USD', label: 'USD · US dollar' },
];
const COUNTRIES = [
  { value: 'CY', label: 'Cyprus' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'GR', label: 'Greece' },
  { value: 'DE', label: 'Germany' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'IE', label: 'Ireland' },
  { value: 'MT', label: 'Malta' },
];
const FEATURES: Array<[string, string]> = [
  ['GPS_TRACKING', 'GPS tracking'],
  ['CUSTOMER_PORTAL', 'Customer portal'],
];
const ROLE_OPTIONS = INVITEABLE_STAFF_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));
const STATUS_LABELS: Record<MembershipStatus, string> = {
  ACTIVE: 'Active',
  INVITED: 'Invite pending',
  DISABLED: 'Disabled',
};
const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');
const title = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

/** Keep an option for a saved value the list does not offer, so the select never shows blank. */
const withValue = (options: Array<{ value: string; label: string }>, value: string) =>
  options.some((o) => o.value === value) ? options : [{ value, label: value }, ...options];

function WorkspaceSettings({ org }: { org: OrganisationView }) {
  const hydrate = useAuth((state) => state.hydrate);
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Partial<Settings>>({});
  const form: Settings = {
    legalName: edits.legalName ?? org.legalName ?? '',
    brandName: edits.brandName ?? org.brandName,
    timezone: edits.timezone ?? org.timezone,
    currency: edits.currency ?? org.currency,
    country: edits.country ?? org.country,
  };
  const changed = Object.keys(edits).length > 0;
  const save = useMutation({
    // The internal name is not on this form; it is sent back unchanged.
    mutationFn: () =>
      api<OrganisationView>('/organisation', {
        method: 'PATCH',
        body: JSON.stringify({ ...form, name: org.name }),
      }),
    onSuccess: async () => {
      setEdits({});
      await queryClient.invalidateQueries({ queryKey: ['organisation'] });
      await hydrate();
    },
  });
  const set = (key: keyof Settings) => (event: CustomEvent<{ value: string }>) => {
    const value = event.detail.value;
    setEdits((current) => ({ ...current, [key]: value }));
  };

  return (
    <Card className="account-card">
      <Heading level={2} size="md">
        Workspace settings
      </Heading>
      <form
        className="account-profile"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && form.brandName.trim()) save.mutate();
        }}
      >
        <TextInput label="Legal name" value={form.legalName ?? ''} onChange={set('legalName')} />
        <TextInput
          label="Brand name, shown in the customer portal"
          required
          value={form.brandName}
          error={!form.brandName.trim() ? 'Enter the name customers see' : ''}
          onChange={set('brandName')}
        />
        <Select label="Timezone" options={withValue(TIMEZONES, form.timezone)} value={form.timezone} onChange={set('timezone')} />
        <Select label="Currency" options={withValue(CURRENCIES, form.currency)} value={form.currency} onChange={set('currency')} />
        <Select label="Country" options={withValue(COUNTRIES, form.country)} value={form.country} onChange={set('country')} />
        <div className="account-actions">
          {save.isSuccess && !changed ? (
            <Text size="sm" tone="muted">
              Saved.
            </Text>
          ) : null}
          <Button type="submit" disabled={!changed || !form.brandName.trim()} busy={save.isPending} busyLabel="Saving the workspace">
            Save workspace
          </Button>
        </div>
        {save.isError ? (
          <Alert tone="danger" heading="The workspace was not saved" className="account-wide">
            {message(save.error)}
          </Alert>
        ) : null}
      </form>
    </Card>
  );
}

function PlanAndFeatures({ org }: { org: OrganisationView }) {
  const routes = useRoutes();
  const count = routes.data?.length ?? 0;
  const fallback = routes.data?.find((route) => route.isDefault);

  return (
    <Card className="account-card">
      <div className="account-card-head">
        <Heading level={2} size="md">
          Plan and features
        </Heading>
        {org.subscription ? <Badge tone="inverse">{title(org.subscription.plan)}</Badge> : null}
      </div>
      <div className="workspace-features">
        {FEATURES.map(([key, label]) => (
          <div key={key} className="workspace-feature">
            <Text size="sm">{label}</Text>
            <Badge tone={org.features[key] ? 'solid' : 'neutral'}>{org.features[key] ? 'On' : 'Off'}</Badge>
          </div>
        ))}
      </div>
      <div className="workspace-routes">
        <Heading level={3} size="sm">
          Routes and stages
        </Heading>
        <Text size="sm" tone="muted">
          {routes.isLoading
            ? 'Loading routes…'
            : count === 0
              ? 'No routes yet.'
              : `${count} ${count === 1 ? 'route' : 'routes'}${fallback ? ` · ${fallback.name} is the default` : ''}`}
        </Text>
        <Link to="/organisation/routes" className="workspace-routes-link">
          Edit routes and stages →
        </Link>
      </div>
    </Card>
  );
}

function Team() {
  const currentUser = useAuth((state) => state.user);
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['organisation-members'],
    queryFn: () => api<Member[]>('/organisation/members'),
  });
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'STAFF' as InviteableStaffRole,
  });
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState<InviteResult | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['organisation-members'] });
  const invite = useMutation({
    mutationFn: () =>
      api<InviteResult>('/organisation/members/invite', {
        method: 'POST',
        body: JSON.stringify(form),
      }),
    onSuccess: async (result) => {
      setSent(result);
      setForm({ name: '', email: '', role: 'STAFF' });
      setTried(false);
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: InviteableStaffRole; status?: 'ACTIVE' | 'DISABLED' } }) =>
      api<Member>(`/organisation/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: refresh,
  });
  const resend = useMutation({
    mutationFn: (id: string) =>
      api<InviteResult>(`/organisation/members/${id}/resend-invite`, {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      setSent(result);
      await refresh();
    },
  });
  const failure = invite.error ?? update.error ?? resend.error;
  const nameMissing = tried && form.name.trim().length < 2;
  const emailMissing = tried && !/^\S+@\S+\.\S+$/.test(form.email.trim());

  return (
    <Card className="account-card">
      <Heading level={2} size="md">
        Team
      </Heading>
      <Text size="sm" tone="muted">
        Invite desk colleagues and set their role. Customers are invited to the portal from their customer record.
      </Text>
      <form
        className="workspace-invite"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (form.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(form.email.trim())) {
            setSent(null);
            invite.mutate();
          }
        }}
      >
        <TextInput
          label="Name"
          autocomplete="off"
          value={form.name}
          error={nameMissing ? 'Enter their name' : ''}
          onChange={(event) => {
            const value = event.detail.value;
            setForm((f) => ({ ...f, name: value }));
          }}
        />
        <TextInput
          label="Email"
          type="email"
          autocomplete="off"
          value={form.email}
          error={emailMissing ? 'Enter an email like name@example.com' : ''}
          onChange={(event) => {
            const value = event.detail.value;
            setForm((f) => ({ ...f, email: value }));
          }}
        />
        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={form.role}
          onChange={(event) => {
            const value = event.detail.value as InviteableStaffRole;
            setForm((f) => ({ ...f, role: value }));
          }}
        />
        <Button type="submit" busy={invite.isPending} busyLabel="Sending the invite">
          Invite
        </Button>
      </form>

      {failure ? (
        <Alert tone="danger" heading="That did not work">
          {message(failure)}
        </Alert>
      ) : null}
      {sent ? <InviteOutcome key={sent.expiresAt} delivery={sent} email={sent.member.user.email} className="invite-link" /> : null}

      {members.isLoading ? (
        <LoadingScreen label="Loading the team…" />
      ) : (
        <div role="list" aria-label="Team members">
          {(members.data ?? []).map((member, index) => {
            const self = member.user.id === currentUser?.id;
            // You cannot change your own role or disable yourself; the API also keeps one active Admin.
            const editable = !self;
            return (
              <div key={member.id} role="listitem" className={`workspace-member${index > 0 ? ' is-divided' : ''}`}>
                <Row heading={self ? `${member.user.name} (you)` : member.user.name} meta={`${member.user.email} · ${STATUS_LABELS[member.status]}`}>
                  <Avatar slot="start" fullName={member.user.name} size="sm" />
                </Row>
                <div className="workspace-member-actions">
                  {editable ? (
                    <Select
                      label={`Role for ${member.user.name}`}
                      hideLabel
                      options={ROLE_OPTIONS}
                      value={member.role}
                      disabled={update.isPending}
                      onChange={(event) =>
                        update.mutate({
                          id: member.id,
                          body: {
                            role: event.detail.value as InviteableStaffRole,
                          },
                        })
                      }
                    />
                  ) : (
                    <Badge tone="inverse">{ROLE_LABELS[member.role]}</Badge>
                  )}
                  {editable && member.status === 'ACTIVE' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      busy={update.isPending}
                      busyLabel="Updating"
                      onClick={() =>
                        update.mutate({
                          id: member.id,
                          body: { status: 'DISABLED' },
                        })
                      }
                    >
                      Disable
                    </Button>
                  ) : null}
                  {editable && member.status === 'DISABLED' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      busy={update.isPending}
                      busyLabel="Updating"
                      onClick={() =>
                        update.mutate({
                          id: member.id,
                          body: { status: 'ACTIVE' },
                        })
                      }
                    >
                      Re-enable
                    </Button>
                  ) : null}
                  {editable && member.status === 'INVITED' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      busy={resend.isPending}
                      busyLabel="Resending"
                      onClick={() => {
                        setSent(null);
                        resend.mutate(member.id);
                      }}
                    >
                      Resend invite
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * Workspace, after the Figma frame "Business · Workspace": the company details,
 * the plan and its features, and the team.
 */
export function OrganisationPage() {
  const organisation = useQuery({
    queryKey: ['organisation'],
    queryFn: () => api<OrganisationView>('/organisation'),
  });
  const org = organisation.data;

  return (
    <div className="account">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          Workspace
        </Heading>
        <Text size="sm">{org?.brandName ?? ' '}</Text>
      </PhoneHeader>

      <div className="account-heading">
        <Heading level={1} size="4xl">
          Workspace
        </Heading>
        <Text tone="muted">Company details, plan, team and agreements for this workspace.</Text>
      </div>

      {organisation.isLoading ? (
        <LoadingScreen label="Loading the workspace…" />
      ) : organisation.isError || !org ? (
        <Alert tone="danger" heading="The workspace could not load">
          Check your connection, then try again.
          <div className="job-retry">
            <Button variant="secondary" onClick={() => void organisation.refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : (
        <>
          <div className="workspace-grid">
            <WorkspaceSettings org={org} />
            <PlanAndFeatures org={org} />
          </div>
          <Team />
          <GpsSettings />
          <AgreementsCard />
        </>
      )}
    </div>
  );
}
