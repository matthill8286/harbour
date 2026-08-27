import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { VehicleLookupResult } from '@vip/shared';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorBanner, PageHeader, StaffPage, fieldClass, primaryBtn, secondaryBtn } from '../components/ui';

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
};

type CreatedJob = { id: string };

const STEPS = ['Customer', 'Vehicle', 'Confirm'];

export function JobNewPage() {
  const { country } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [customerId, setCustomerId] = useState('');
  const [newCustomer, setNewCustomer] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [lookup, setLookup] = useState<VehicleLookupResult | null>(null);
  const [scanMeta, setScanMeta] = useState<{ confidence: number; source: string } | null>(null);
  const [registration, setRegistration] = useState('');
  const [originCountry, setOriginCountry] = useState('GB');
  const [destinationCountry, setDestinationCountry] = useState(country);
  const [registrationCountry, setRegistrationCountry] = useState('BG');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Customer[]>('/customers'),
  });

  const createCustomer = useMutation({
    mutationFn: () =>
      api<Customer>('/customers', {
        method: 'POST',
        body: JSON.stringify(newCustomer),
      }),
    onSuccess: (customer) => {
      setCustomerId(customer.id);
      setStep(2);
    },
  });

  const createJob = useMutation({
    mutationFn: () =>
      api<CreatedJob>('/import-jobs', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          ukRegistration: lookup?.registration ?? registration,
          vin: lookup?.vin,
          make: lookup?.make,
          model: lookup?.model,
          variant: lookup?.variant,
          year: lookup?.year,
          colour: lookup?.colour,
          fuelType: lookup?.fuelType,
          engineSize: lookup?.engineSize,
          bodyType: lookup?.bodyType,
          mileage: lookup?.mileage,
          countryOfRegistration: lookup?.countryOfRegistration ?? 'GB',
          originCountry,
          destinationCountry,
          registrationCountry,
          expectedDeliveryDate: expectedDeliveryDate || undefined,
        }),
      }),
    onSuccess: (job) => navigate(`/jobs/${job.id}`),
  });

  const selectedCustomer = useMemo(
    () => customers.data?.find((item) => item.id === customerId),
    [customers.data, customerId],
  );

  async function lookupPlate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await api<VehicleLookupResult>('/vehicles/lookup', {
        method: 'POST',
        body: JSON.stringify({ registration }),
      });
      setLookup(result);
      setScanMeta(null);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    }
  }

  async function scanPlate(file: File) {
    const body = new FormData();
    body.append('image', file);
    setError(null);
    try {
      const result = await api<{
        lookup: VehicleLookupResult;
        confidence: number;
        source: string;
      }>('/vehicles/scan-plate', {
        method: 'POST',
        body,
      });
      setLookup(result.lookup);
      setRegistration(result.lookup.registration);
      setScanMeta({ confidence: result.confidence, source: result.source });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    }
  }

  return (
    <StaffPage>
      <PageHeader
        eyebrow="Create"
        title="New import job"
        description={`Step ${step} of 3 — ${STEPS[step - 1]}`}
        actions={
          <Link to="/jobs" className="text-sm font-semibold text-harbour">
            Cancel
          </Link>
        }
      />
      <div className="flex gap-2">
        {STEPS.map((label, index) => (
          <div key={label} className="flex-1">
            <div className={`h-1.5 rounded-full ${step > index ? 'bg-harbour' : 'bg-ink/10'}`} />
            <p className={`mt-1 text-[11px] ${step === index + 1 ? 'font-semibold text-harbour' : 'text-ink/40'}`}>
              {label}
            </p>
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="space-y-4 rounded-2xl bg-paper p-4">
          <h2 className="display text-2xl">Who owns the vehicle?</h2>
          <label className="block text-sm font-semibold">
            Existing customer
            <select className={`${fieldClass} mt-1`} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Select a customer</option>
              {(customers.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.firstName} {customer.lastName}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!customerId} className={primaryBtn} onClick={() => setStep(2)}>
            Continue
          </button>
          <p className="text-xs uppercase tracking-widest text-ink/40">or create</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={fieldClass} placeholder="First name" value={newCustomer.firstName} onChange={(event) => setNewCustomer({ ...newCustomer, firstName: event.target.value })} />
            <input className={fieldClass} placeholder="Last name" value={newCustomer.lastName} onChange={(event) => setNewCustomer({ ...newCustomer, lastName: event.target.value })} />
            <input className={fieldClass} placeholder="Email" value={newCustomer.email} onChange={(event) => setNewCustomer({ ...newCustomer, email: event.target.value })} />
            <input className={fieldClass} placeholder="Phone" value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} />
          </div>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => createCustomer.mutate()}
            disabled={!newCustomer.firstName || !newCustomer.lastName || createCustomer.isPending}
          >
            Save customer
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <form className="space-y-4 rounded-2xl bg-paper p-4" onSubmit={lookupPlate}>
          <h2 className="display text-2xl">Vehicle</h2>
          <p className="text-sm text-ink/60">
            For {selectedCustomer?.firstName} {selectedCustomer?.lastName}. Scan a plate photo or type the
            UK registration — Harbour looks it up via the configured vehicle data provider.
          </p>
          <label className="block text-sm font-semibold">
            Scan number plate
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-1 block w-full text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void scanPlate(file);
              }}
            />
          </label>
          <label className="block text-sm font-semibold">
            Or type UK registration
            <input
              className={`${fieldClass} mt-1`}
              placeholder="KN19 XPL"
              value={registration}
              onChange={(event) => setRegistration(event.target.value.toUpperCase())}
            />
          </label>
          {error ? <ErrorBanner message={error} /> : null}
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={() => setStep(1)}>
              Back
            </button>
            <button type="submit" className={primaryBtn} disabled={!registration}>
              Look up vehicle
            </button>
          </div>
        </form>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4 rounded-2xl bg-paper p-4">
          <h2 className="display text-2xl">Confirm job</h2>
          <p className="text-sm">
            {lookup?.make} {lookup?.model} {lookup?.variant}
            <span className="block text-ink/55">
              {lookup?.registration} · {lookup?.colour} · {lookup?.year}
            </span>
            <span className="mt-1 block text-xs text-ink/45">
              Source: {lookup?.source ?? 'unknown'}
              {scanMeta
                ? ` · plate scan ${Math.round(scanMeta.confidence * 100)}% (${scanMeta.source})`
                : ''}
            </span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Origin
              <input className={`${fieldClass} mt-1`} value={originCountry} onChange={(event) => setOriginCountry(event.target.value)} />
            </label>
            <label className="text-sm font-semibold">
              Destination
              <input className={`${fieldClass} mt-1`} value={destinationCountry} onChange={(event) => setDestinationCountry(event.target.value)} />
            </label>
            <label className="text-sm font-semibold">
              Registration country
              <input className={`${fieldClass} mt-1`} value={registrationCountry} onChange={(event) => setRegistrationCountry(event.target.value)} />
            </label>
            <label className="text-sm font-semibold">
              Expected delivery
              <input className={`${fieldClass} mt-1`} type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} />
            </label>
          </div>
          {createJob.isError ? (
            <ErrorBanner message={createJob.error instanceof Error ? createJob.error.message : 'Could not create job'} />
          ) : null}
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={() => setStep(2)}>
              Back
            </button>
            <button type="button" className={primaryBtn} onClick={() => createJob.mutate()} disabled={createJob.isPending}>
              {createJob.isPending ? 'Creating…' : 'Create import job'}
            </button>
          </div>
        </div>
      ) : null}
    </StaffPage>
  );
}
