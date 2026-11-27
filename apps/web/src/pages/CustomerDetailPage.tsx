import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Heading, Row, Text, TextInput, Textarea } from '@atomic-ui/ui-react';
import { getStatusLabel, type JobStatus } from '@vip/shared';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import { PORTAL_LABEL, PORTAL_TONE, type PortalStatus } from './customers/portal';
import './customers/Customers.css';

type CustomerDetail = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  portal: { status: PortalStatus; email: string | null; invitedAt: string | null; expiresAt: string | null };
  importJobs: {
    id: string;
    reference: string;
    status: JobStatus;
    expectedDeliveryDate: string | null;
    vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
  }[];
};

type Contact = { firstName: string; lastName: string; email: string; phone: string; address: string; notes: string };

/** What the Portal card says and offers in each state, after the Figma frames "Customer record · …". */
const PORTAL: Record<PortalStatus, { body: string; action: string }> = {
  NONE: {
    body: 'Invite them with the email on this record. Harbour emails the invite when mail is set up, and shows a link here to copy.',
    action: 'Invite to portal',
  },
  INVITED: {
    body: 'They have not set a password yet. Resending emails a fresh link; the old one stops working.',
    action: 'Resend invite',
  },
  ACTIVE: {
    body: 'The customer can sign in and sees only their own jobs and what you marked visible.',
    action: 'Send password reset link',
  },
};

export function CustomerDetailPage() {
  const { canWrite } = useSession();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`), enabled: Boolean(id) });
  const customer = query.data;
  const [edits, setEdits] = useState<Partial<Contact>>({});
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['customer', id] }), queryClient.invalidateQueries({ queryKey: ['customers'] })]);
  const contact: Contact | null = customer
    ? {
        firstName: edits.firstName ?? customer.firstName,
        lastName: edits.lastName ?? customer.lastName,
        email: edits.email ?? customer.email ?? '',
        phone: edits.phone ?? customer.phone ?? '',
        address: edits.address ?? customer.address ?? '',
        notes: edits.notes ?? customer.notes ?? '',
      }
    : null;
  const changed = Object.keys(edits).length > 0;

  const save = useMutation({
    mutationFn: () => api(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify({ ...contact, email: contact?.email.trim() || undefined }) }),
    onSuccess: async () => {
      setEdits({});
      await refresh();
    },
  });
  const invite = useMutation({
    mutationFn: () => api<{ inviteUrl: string }>(`/customers/${id}/invite`, { method: 'POST' }),
    onSuccess: async (result) => {
      setInviteUrl(result.inviteUrl);
      setCopied(false);
      await refresh();
    },
  });

  if (query.isLoading) return <LoadingScreen label="Loading the customer…" />;
  if (query.isError || !customer || !contact) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Alert tone="danger" heading={notFound ? 'This customer does not exist' : 'The customer could not load'}>
        {notFound ? 'They may have been removed, or the link is wrong.' : 'Check your connection, then try again.'}
        <div className="job-retry">
          <Button variant="ghost" href="/customers">
            Back to customers
          </Button>
        </div>
      </Alert>
    );
  }

  const name = `${customer.firstName} ${customer.lastName}`.trim();
  const set = (key: keyof Contact) => (e: CustomEvent<{ value: string }>) => {
    const value = e.detail.value;
    setEdits((current) => ({ ...current, [key]: value }));
  };
  const portal = PORTAL[customer.portal.status];

  return (
    <div className="customers">
      <PhoneHeader>
        <Text size="sm">Customer</Text>
        <Heading level={1} size="3xl">
          {name}
        </Heading>
      </PhoneHeader>

      <div className="customer-heading">
        <Button icon="arrow-left" label="Back to customers" variant="secondary" onClick={() => navigate('/customers')} />
        <div className="customer-title">
          <Text size="sm" tone="muted">{`Customer${customer.email ? ` · ${customer.email}` : ''}`}</Text>
          <Heading level={1} size="3xl">
            {name}
          </Heading>
        </div>
        {canWrite ? (
          <Button variant="secondary" iconBefore="plus" href={`/jobs/new?customer=${customer.id}`}>
            {`New job for ${customer.firstName}`}
          </Button>
        ) : null}
      </div>

      <div className="customer-grid">
        <Card className="customers-card">
          <Heading level={2} size="md">
            Contact
          </Heading>
          <form
            className="customer-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (contact.firstName.trim() && contact.lastName.trim()) save.mutate();
            }}
          >
            <TextInput label="First name" required disabled={!canWrite} value={contact.firstName} onChange={set('firstName')} />
            <TextInput label="Last name" required disabled={!canWrite} value={contact.lastName} onChange={set('lastName')} />
            <TextInput label="Email" type="email" disabled={!canWrite} value={contact.email} onChange={set('email')} />
            <TextInput label="Phone" type="tel" disabled={!canWrite} value={contact.phone} onChange={set('phone')} />
            <TextInput label="Address" disabled={!canWrite} value={contact.address} onChange={set('address')} className="customer-wide" />
            <Textarea
              label="Internal notes, never shown in the portal"
              rows={3}
              disabled={!canWrite}
              value={contact.notes}
              onChange={set('notes')}
              className="customer-wide"
            />
            {save.isError ? (
              <Alert tone="danger" heading="The changes were not saved" className="customer-wide">
                {save.error instanceof Error ? save.error.message : 'Try again.'}
              </Alert>
            ) : null}
            {canWrite ? (
              <div className="customer-wide customer-save">
                {save.isSuccess && !changed ? (
                  <Text size="sm" tone="muted">
                    Saved.
                  </Text>
                ) : null}
                <Button
                  type="submit"
                  disabled={!changed || !contact.firstName.trim() || !contact.lastName.trim()}
                  busy={save.isPending}
                  busyLabel="Saving the changes"
                >
                  Save changes
                </Button>
              </div>
            ) : null}
          </form>
        </Card>

        <aside className="customer-side" aria-label="Portal and jobs">
          <Card className="customers-card">
            <div className="job-card-head">
              <div>
                <Heading level={2} size="md">
                  Portal
                </Heading>
                <Text size="sm" tone="muted">
                  {canWrite ? 'Portal access is managed by you.' : 'Portal access is managed by the workspace owner.'}
                </Text>
              </div>
              <Badge tone={PORTAL_TONE[customer.portal.status]}>{PORTAL_LABEL[customer.portal.status]}</Badge>
            </div>
            <Text size="sm">{portal.body}</Text>
            {customer.portal.status === 'INVITED' && customer.portal.expiresAt ? (
              <Text size="sm" tone="muted">{`The invite expires on ${formatDate(customer.portal.expiresAt)}.`}</Text>
            ) : null}
            {canWrite ? (
              <div className="customer-portal-action">
                {customer.email ? null : (
                  <Text size="sm" tone="muted">
                    Add an email above first; the invite goes to it.
                  </Text>
                )}
                <Button
                  variant={customer.portal.status === 'NONE' ? 'primary' : 'secondary'}
                  full
                  disabled={!customer.email}
                  busy={invite.isPending}
                  busyLabel="Creating the link"
                  onClick={() => invite.mutate()}
                >
                  {portal.action}
                </Button>
              </div>
            ) : null}
            {inviteUrl ? (
              <div className="customer-link">
                <Text size="sm">Copy this link now if they need it. Harbour keeps only a fingerprint of it, so it cannot be shown again.</Text>
                <code>{inviteUrl}</code>
                <Button
                  variant="secondary"
                  size="sm"
                  iconBefore={copied ? 'check' : 'document'}
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true));
                  }}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
            ) : null}
            {invite.isError ? (
              <Alert tone="danger" heading="No link was created">
                {invite.error instanceof Error ? invite.error.message : 'Try again.'}
              </Alert>
            ) : null}
          </Card>

          <Card className="customers-card">
            <div className="job-card-head">
              <Heading level={2} size="md">
                Import jobs
              </Heading>
              <Text size="sm" tone="muted">{`${customer.importJobs.length} ${customer.importJobs.length === 1 ? 'job' : 'jobs'}`}</Text>
            </div>
            {customer.importJobs.length === 0 ? (
              <Text tone="muted">No jobs for this customer yet.</Text>
            ) : (
              <div role="list">
                {customer.importJobs.map((job) => (
                  <Row
                    key={job.id}
                    role="listitem"
                    heading={job.reference}
                    meta={[[job.vehicle.make, job.vehicle.model].filter(Boolean).join(' '), job.vehicle.ukRegistration].filter(Boolean).join(' · ')}
                    href={`/jobs/${job.id}`}
                  >
                    <Badge slot="end">{getStatusLabel(job.status)}</Badge>
                  </Row>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
