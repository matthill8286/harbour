import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Alert, Avatar, Badge, Button, Card, EmptyState, Heading, Table, Text, TextInput } from '@atomic-ui/ui-react';
import { api } from '../lib/api';
import { usePagedList, type Page } from '../lib/pages';
import { useSession } from '../lib/session';
import { openRowLink } from '../lib/tableRows';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import { PORTAL_LABEL, PORTAL_TONE, type PortalStatus } from './customers/portal';
import './customers/Customers.css';

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  _count: { importJobs: number };
  portal: { status: PortalStatus };
};

const COLUMNS = [
  { key: 'customer', label: 'Customer' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'portal', label: 'Portal' },
];

/** How many customers show before Load more. */
const PAGE = 50;

const BLANK = { firstName: '', lastName: '', email: '', phone: '' };
const fullName = (c: Pick<Customer, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`.trim();
const jobs = (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'}`;

/**
 * Customers, after the Figma frames "Business · Customers": a new customer to
 * add, and everyone the workspace imports for, with their jobs and where they are
 * with the portal.
 */
export function CustomersPage() {
  const { canWrite } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(BLANK);
  const [tried, setTried] = useState(false);
  const query = usePagedList<Page<Customer>>(['customers', 'list'], '/customers', { limit: PAGE });
  const create = useMutation({
    mutationFn: () =>
      api('/customers', { method: 'POST', body: JSON.stringify({ ...form, email: form.email.trim() || undefined, phone: form.phone.trim() || undefined }) }),
    onSuccess: async () => {
      setForm(BLANK);
      setTried(false);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const set = (key: keyof typeof BLANK) => (e: CustomEvent<{ value: string }>) => {
    const value = e.detail.value;
    setForm((f) => ({ ...f, [key]: value }));
  };
  const customers = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0].total ?? 0;

  return (
    <div className="customers">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          Customers
        </Heading>
        <Text size="sm">{total ? `${total} in this workspace` : ' '}</Text>
      </PhoneHeader>

      <div className="customers-heading">
        <Heading level={1} size="4xl" className="customers-title">
          Customers
        </Heading>
        <Text tone="muted">End customers of this workspace. They only see jobs assigned to them.</Text>
      </div>

      {canWrite ? (
        <Card className="customers-card">
          <Heading level={2} size="md">
            New customer
          </Heading>
          <Text size="sm" tone="muted">
            Add the vehicle owner before creating a job.
          </Text>
          <form
            className="customers-new"
            onSubmit={(event) => {
              event.preventDefault();
              setTried(true);
              if (form.firstName.trim() && form.lastName.trim()) create.mutate();
            }}
          >
            <TextInput
              label="First name"
              required
              autocomplete="off"
              value={form.firstName}
              error={tried && !form.firstName.trim() ? 'Enter a first name' : ''}
              onChange={set('firstName')}
            />
            <TextInput
              label="Last name"
              required
              autocomplete="off"
              value={form.lastName}
              error={tried && !form.lastName.trim() ? 'Enter a last name' : ''}
              onChange={set('lastName')}
            />
            <TextInput label="Email" type="email" autocomplete="off" placeholder="name@example.com" value={form.email} onChange={set('email')} />
            <TextInput label="Phone" type="tel" autocomplete="off" placeholder="+357 …" value={form.phone} onChange={set('phone')} />
            <Button type="submit" busy={create.isPending} busyLabel="Adding the customer">
              Add customer
            </Button>
          </form>
          {create.isError ? (
            <Alert tone="danger" heading="The customer was not added">
              {create.error instanceof Error ? create.error.message : 'Try again.'}
            </Alert>
          ) : null}
        </Card>
      ) : null}

      {query.isLoading ? (
        <LoadingScreen label="Loading customers…" />
      ) : query.isError && !query.isFetchNextPageError ? (
        <Alert tone="danger" heading="Customers could not load">
          Check your connection, then try again.
          <div className="job-retry">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : customers.length === 0 ? (
        <EmptyState
          heading="No customers yet"
          lead={canWrite ? 'Add the vehicle owner above, then create their first job.' : 'This workspace has no customers yet.'}
          framed
        />
      ) : (
        <Card className="customers-card" padding="sm">
          <Table
            className="customers-table"
            caption="Customers"
            columns={COLUMNS}
            stack
            rows={customers.map((c) => ({
              id: c.id,
              customer: fullName(c),
              email: c.email ?? 'No email',
              phone: c.phone ?? '—',
              jobs: jobs(c._count.importJobs),
              portal: PORTAL_LABEL[c.portal.status],
            }))}
            onClick={(event) => openRowLink(event, navigate)}
          >
            {customers.flatMap((c) => [
              <span key={`${c.id}-name`} slot={`cell:${c.id}:customer`} className="customers-name">
                <Avatar fullName={fullName(c)} size="sm" />
                <a href={`/customers/${c.id}`}>{fullName(c)}</a>
              </span>,
              <Badge key={`${c.id}-portal`} slot={`cell:${c.id}:portal`} tone={PORTAL_TONE[c.portal.status]}>
                {PORTAL_LABEL[c.portal.status]}
              </Badge>,
            ])}
          </Table>
          {total > PAGE ? (
            <div className="customers-foot">
              <Text size="sm" tone="muted">{`Showing ${customers.length} of ${total} customers`}</Text>
              {query.hasNextPage ? (
                <Button variant="ghost" size="sm" busy={query.isFetchingNextPage} busyLabel="Loading more customers" onClick={() => void query.fetchNextPage()}>
                  Load more
                </Button>
              ) : null}
            </div>
          ) : null}
          {query.isFetchNextPageError ? (
            <Alert tone="danger" heading="More customers could not load">
              Check your connection, then choose Load more again.
            </Alert>
          ) : null}
        </Card>
      )}
    </div>
  );
}
