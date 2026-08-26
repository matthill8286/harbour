import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Card, EmptyState, PageHeader, StaffPage, fieldClass, primaryBtn } from '../components/ui';
import { useSession } from '../lib/session';

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  _count: { importJobs: number };
  portal: { status: 'NONE' | 'INVITED' | 'ACTIVE' };
};

export function CustomersPage() {
  const { canWrite } = useSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const { data, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Customer[]>('/customers'),
  });
  const create = useMutation({
    mutationFn: () => api('/customers', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      setForm({ firstName: '', lastName: '', email: '', phone: '' });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  return (
    <StaffPage>
      <PageHeader
        eyebrow="Directory"
        title="Customers"
        description="End customers of this organisation. They only see jobs assigned to them."
      />
      {canWrite ? (
      <Card className="grid gap-2 sm:grid-cols-2">
        <input className={fieldClass} placeholder="First name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
        <input className={fieldClass} placeholder="Last name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
        <input className={fieldClass} placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <input className={fieldClass} placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <button
          type="button"
          className={`${primaryBtn} sm:col-span-2`}
          onClick={() => create.mutate()}
          disabled={!form.firstName || !form.lastName || create.isPending}
        >
          Add customer
        </button>
      </Card>
      ) : null}
      {!isLoading && (data ?? []).length === 0 ? (
        <EmptyState
          title="No customers yet"
          description={canWrite ? 'Add the vehicle owner before creating a job.' : 'This organisation has no customers yet.'}
        />
      ) : (
        <ul className="space-y-2">
          {(data ?? []).map((customer) => (
            <li key={customer.id} className="rounded-2xl bg-paper p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link to={`/customers/${customer.id}`} className="font-semibold hover:text-harbour">
                    {customer.firstName} {customer.lastName}
                  </Link>
                  <p className="text-sm text-ink/60">
                    {customer.email ?? 'No email'}
                    {customer.phone ? ` · ${customer.phone}` : ''} · {customer._count.importJobs}{' '}
                    {customer._count.importJobs === 1 ? 'job' : 'jobs'}
                  </p>
                </div>
                <span className="rounded-full bg-sand px-2.5 py-1 text-[11px] font-semibold text-ink/70">
                  {customer.portal.status === 'ACTIVE'
                    ? 'Portal active'
                    : customer.portal.status === 'INVITED'
                      ? 'Invite pending'
                      : 'No portal'}
                </span>
              </div>
              <Link to={`/customers/${customer.id}`} className="mt-2 inline-block text-sm font-semibold text-harbour">
                Open record
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StaffPage>
  );
}
