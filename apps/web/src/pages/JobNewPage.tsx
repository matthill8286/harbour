import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, FileUpload, Heading, Progress, Select, Text, TextInput } from '@atomic-ui/ui-react';
import { UK_CYPRUS_ROUTE_KEY, type VehicleCapabilities, type VehicleLookupResult } from '@vip/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { useWorkflows } from '../lib/workflows';
import { useCustomerPicker } from './customers/useCustomerPicker';
import { PhoneHeader } from '../components/PhoneHeader';
import { COUNTRY_CODES, countryName } from './job/countries';
import './JobNewPage.css';

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
};

type CreatedJob = { id: string };

type Step = 'customer' | 'vehicle' | 'confirm';

const STEPS: { id: Step; label: string }[] = [
  { id: 'customer', label: '1. Customer' },
  { id: 'vehicle', label: '2. Vehicle' },
  { id: 'confirm', label: '3. Confirm' },
];
const STEP_NAMES: Record<Step, string> = { customer: 'Customer', vehicle: 'Vehicle', confirm: 'Confirm' };

const fullName = (customer: { firstName: string; lastName: string }) => `${customer.firstName} ${customer.lastName}`.trim();
const vehicleTitle = (lookup: VehicleLookupResult) => [lookup.make, lookup.model, lookup.variant].filter(Boolean).join(' ') || 'Vehicle';

export function JobNewPage() {
  const { country } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('customer');
  // A customer record's "New job for …" opens this page with that customer chosen.
  const [customerId, setCustomerId] = useState(params.get('customer') ?? '');
  const [newCustomer, setNewCustomer] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [lookup, setLookup] = useState<VehicleLookupResult | null>(null);
  const [scanMeta, setScanMeta] = useState<{ confidence: number; source: string } | null>(null);
  const [registration, setRegistration] = useState('');
  const [originCountry, setOriginCountry] = useState('GB');
  const [destinationCountry, setDestinationCountry] = useState(country);
  const [registrationCountry, setRegistrationCountry] = useState('BG');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  // Routes New job can use: switched on. The default is preselected; the API uses it when none is sent.
  const workflows = useWorkflows();
  const activeRoutes = workflows.routes.filter((route) => route.active);
  const [routeId, setRouteId] = useState('');
  const route = activeRoutes.find((r) => r.id === routeId) ?? activeRoutes.find((r) => r.isDefault);
  const chooseRoute = (id: string) => {
    setRouteId(id);
    const picked = activeRoutes.find((r) => r.id === id);
    if (picked) {
      setOriginCountry(picked.originCountry);
      setDestinationCountry(picked.destinationCountry);
      // UK → Cyprus registers vehicles in Bulgaria on the way; other routes register on arrival.
      setRegistrationCountry(picked.systemKey === UK_CYPRUS_ROUTE_KEY ? 'BG' : picked.destinationCountry);
    }
  };
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  // Without a real provider, a live workspace has no lookup or scan. The screen says so.
  const capabilities = useQuery({
    queryKey: ['vehicle-capabilities'],
    queryFn: () => api<VehicleCapabilities>('/vehicles/capabilities'),
  });
  const canLookUp = capabilities.data?.lookup !== false;
  const canScan = capabilities.data?.scan !== false;

  const countryOptions = useMemo(() => {
    const codes = new Set([...COUNTRY_CODES, country, originCountry, destinationCountry, registrationCountry]);
    return [...codes].map((code) => ({ value: code, label: countryName(code) }));
  }, [country, originCountry, destinationCountry, registrationCountry]);

  const customers = useCustomerPicker(customerId);

  const createCustomer = useMutation({
    mutationFn: () =>
      api<Customer>('/customers', {
        method: 'POST',
        // An email or phone left empty is not sent: the API refuses an empty email.
        body: JSON.stringify({ ...newCustomer, email: newCustomer.email.trim() || undefined, phone: newCustomer.phone.trim() || undefined }),
      }),
    onSuccess: (customer) => {
      customers.remember(customer);
      void customers.refetch();
      setCustomerId(customer.id);
      setNewCustomer({ firstName: '', lastName: '', email: '', phone: '' });
      setStep('vehicle');
    },
  });

  const createJob = useMutation({
    mutationFn: () =>
      api<CreatedJob>('/import-jobs', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          ...(route ? { routeId: route.id } : {}),
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

  const selectedCustomer = customers.selected;
  const customerOptions = customers.options.map((customer) => ({ value: customer.id, label: fullName(customer) }));
  const chooseCustomer = (id: string) => {
    const picked = customers.options.find((item) => item.id === id);
    if (picked) customers.remember(picked);
    setCustomerId(id);
  };

  async function lookupPlate(event?: FormEvent) {
    event?.preventDefault();
    if (!registration.trim()) return;
    setLookupError(null);
    setLookingUp(true);
    try {
      const result = await api<VehicleLookupResult>('/vehicles/lookup', {
        method: 'POST',
        body: JSON.stringify({ registration: registration.trim() }),
      });
      setLookup(result);
      setScanMeta(null);
      setStep('confirm');
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'The vehicle could not be looked up.');
    } finally {
      setLookingUp(false);
    }
  }

  async function scanPlate(file: File) {
    const body = new FormData();
    body.append('image', file);
    setLookupError(null);
    setLookingUp(true);
    try {
      const result = await api<{ lookup: VehicleLookupResult; confidence: number; source: string }>('/vehicles/scan-plate', {
        method: 'POST',
        body,
      });
      setLookup(result.lookup);
      setRegistration(result.lookup.registration);
      setScanMeta({ confidence: result.confidence, source: result.source });
      setStep('confirm');
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'The plate could not be read.');
    } finally {
      setLookingUp(false);
    }
  }

  const stepNumber = STEPS.findIndex((s) => s.id === step) + 1;
  const back = () => (step === 'confirm' ? setStep('vehicle') : step === 'vehicle' ? setStep('customer') : navigate('/jobs'));
  const canSaveCustomer = Boolean(newCustomer.firstName.trim() && newCustomer.lastName.trim());

  return (
    <div className="new-job">
      <PhoneHeader>
        <Text size="sm">{`Step ${stepNumber} of 3 · ${STEP_NAMES[step]}`}</Text>
        <Heading level={1} size="3xl">
          New import job
        </Heading>
      </PhoneHeader>

      <div className="new-job-heading">
        <Button icon="arrow-left" label={step === 'customer' ? 'Back to jobs' : 'Back a step'} variant="secondary" onClick={back} />
        <div className="new-job-title">
          <Text size="sm" tone="muted">{`Step ${stepNumber} of 3 · ${STEP_NAMES[step]}`}</Text>
          <Heading level={1} size="3xl">
            New import job
          </Heading>
        </div>
        <Button variant="secondary" href="/jobs">
          Cancel
        </Button>
      </div>

      <div className="new-job-grid">
        <Card className="new-job-card">
          <Progress look="bars" label="New job" steps={STEPS} current={step} />

          {step === 'customer' ? (
            <section className="new-job-step" aria-labelledby="new-job-customer">
              <Heading level={2} size="xl" id="new-job-customer">
                Who owns the vehicle?
              </Heading>
              {customers.searchable ? (
                <TextInput
                  type="search"
                  label="Search customers"
                  description={`Showing ${customers.shown} of ${customers.total} ${customers.search ? 'matches' : 'customers'}. Search by name, email or phone.`}
                  autocomplete="off"
                  value={customers.search}
                  onChange={(event) => customers.setSearch(event.detail.value)}
                />
              ) : null}
              <Select
                label="Existing customer"
                placeholder={customers.isLoading ? 'Loading customers…' : 'Choose a customer'}
                options={customerOptions}
                value={customerId}
                disabled={customers.isLoading}
                onChange={(event) => chooseCustomer(event.detail.value)}
              />
              <p className="new-job-or" role="separator">
                <span>Or create a new customer</span>
              </p>
              <div className="new-job-fields">
                <TextInput
                  label="First name"
                  autocomplete="off"
                  value={newCustomer.firstName}
                  onChange={(e) => {
                    const value = e.detail.value;
                    setNewCustomer((c) => ({ ...c, firstName: value }));
                  }}
                />
                <TextInput
                  label="Last name"
                  autocomplete="off"
                  value={newCustomer.lastName}
                  onChange={(e) => {
                    const value = e.detail.value;
                    setNewCustomer((c) => ({ ...c, lastName: value }));
                  }}
                />
                <TextInput
                  label="Email"
                  type="email"
                  autocomplete="off"
                  placeholder="name@example.com"
                  value={newCustomer.email}
                  onChange={(e) => {
                    const value = e.detail.value;
                    setNewCustomer((c) => ({ ...c, email: value }));
                  }}
                />
                <TextInput
                  label="Phone"
                  type="tel"
                  autocomplete="off"
                  placeholder="+357 …"
                  value={newCustomer.phone}
                  onChange={(e) => {
                    const value = e.detail.value;
                    setNewCustomer((c) => ({ ...c, phone: value }));
                  }}
                />
              </div>
              {createCustomer.isError ? (
                <Alert tone="danger" heading="The customer was not saved">
                  {createCustomer.error instanceof Error ? createCustomer.error.message : 'Try again.'}
                </Alert>
              ) : null}
              <div>
                <Button
                  variant="subtle"
                  disabled={!canSaveCustomer}
                  busy={createCustomer.isPending}
                  busyLabel="Saving the customer"
                  onClick={() => createCustomer.mutate()}
                >
                  Save customer
                </Button>
              </div>
              <div className="new-job-actions">
                <Text size="sm" tone="muted">
                  Customers can be invited to the portal later from their record.
                </Text>
                <Button iconAfter="arrow-right" disabled={!customerId} onClick={() => setStep('vehicle')}>
                  Continue
                </Button>
              </div>
            </section>
          ) : null}

          {step === 'vehicle' ? (
            <form className="new-job-step" aria-labelledby="new-job-vehicle" onSubmit={lookupPlate}>
              <Heading level={2} size="xl" id="new-job-vehicle">
                Vehicle
              </Heading>
              <Text tone="muted">
                {`For ${selectedCustomer ? fullName(selectedCustomer) : 'the customer'}. ${
                  canLookUp ? 'Type the UK registration and Harbour looks the vehicle up with the configured data provider.' : 'Type the UK registration.'
                }`}
              </Text>
              {!canLookUp ? (
                <Alert tone="warning" heading="Vehicle lookup is not available">
                  {`No vehicle data provider is set up, so the job is created with the registration only.${canScan ? '' : ' Plate scanning is not available either.'}`}
                </Alert>
              ) : null}
              <TextInput
                label="UK registration"
                placeholder="KN19 XPL"
                autocomplete="off"
                value={registration}
                onChange={(e) => setRegistration(e.detail.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void lookupPlate();
                }}
              />
              {canScan ? (
                <FileUpload
                  label="Or scan the number plate"
                  description="A photo of the plate. Harbour reads the registration from it."
                  accept="image/*"
                  onFiles={(e) => {
                    const file = e.detail.files[0];
                    if (file) void scanPlate(file);
                  }}
                />
              ) : canLookUp ? (
                <Text size="sm" tone="muted">
                  Plate scanning is not available. Type the registration instead.
                </Text>
              ) : null}
              {lookupError ? (
                <Alert tone="danger" heading="The vehicle could not be looked up">
                  {lookupError}
                </Alert>
              ) : null}
              <div className="new-job-actions">
                <Button variant="secondary" iconBefore="arrow-left" onClick={() => setStep('customer')}>
                  Back
                </Button>
                <Button type="submit" iconAfter="arrow-right" disabled={!registration.trim()} busy={lookingUp} busyLabel="Looking up the vehicle">
                  {canLookUp ? 'Look up vehicle' : 'Continue'}
                </Button>
              </div>
            </form>
          ) : null}

          {step === 'confirm' && lookup ? (
            <section className="new-job-step" aria-labelledby="new-job-confirm">
              <Heading level={2} size="xl" id="new-job-confirm">
                Confirm job
              </Heading>
              <div className="new-job-vehicle">
                <span className="new-job-plate">{lookup.registration}</span>
                <span>
                  <strong>{vehicleTitle(lookup)}</strong>
                  <Text size="sm" tone="muted">
                    {[lookup.colour, lookup.year].filter(Boolean).join(' · ') || 'No colour or year from the provider'}
                  </Text>
                  <Text size="sm" tone="muted">
                    {`${lookup.source === 'unavailable' ? 'Vehicle lookup is not available. Only the registration is filled in.' : `Source: ${lookup.source}`}${
                      scanMeta ? ` · plate read at ${Math.round(scanMeta.confidence * 100)}% (${scanMeta.source})` : ''
                    }`}
                  </Text>
                </span>
              </div>
              <div className="new-job-fields">
                {activeRoutes.length > 1 ? (
                  <Select
                    label="Route"
                    description="The job follows this route's stages and statuses."
                    options={activeRoutes.map((r) => ({ value: r.id, label: r.name }))}
                    value={route?.id ?? ''}
                    onChange={(e) => chooseRoute(e.detail.value)}
                    className="new-job-route"
                  />
                ) : null}
                <Select label="Origin" options={countryOptions} value={originCountry} onChange={(e) => setOriginCountry(e.detail.value)} />
                <Select label="Destination" options={countryOptions} value={destinationCountry} onChange={(e) => setDestinationCountry(e.detail.value)} />
                <Select
                  label="Registration country"
                  options={countryOptions}
                  value={registrationCountry}
                  onChange={(e) => setRegistrationCountry(e.detail.value)}
                />
                <TextInput label="Expected delivery" type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.detail.value)} />
              </div>
              {createJob.isError ? (
                <Alert tone="danger" heading="The job was not created">
                  {createJob.error instanceof Error ? createJob.error.message : 'Try again.'}
                </Alert>
              ) : null}
              <div className="new-job-actions">
                <Button variant="secondary" iconBefore="arrow-left" onClick={() => setStep('vehicle')}>
                  Back
                </Button>
                <Button iconAfter="arrow-right" busy={createJob.isPending} busyLabel="Creating the job" onClick={() => createJob.mutate()}>
                  Create import job
                </Button>
              </div>
            </section>
          ) : null}
        </Card>

        <Card className="new-job-summary">
          <Heading level={2} size="md">
            Job summary
          </Heading>
          <dl>
            <SummaryItem label="Customer" value={selectedCustomer ? fullName(selectedCustomer) : null} pending="Chosen in step 1" />
            <SummaryItem
              label="Vehicle"
              value={lookup ? `${vehicleTitle(lookup)} · ${lookup.registration}` : lookingUp ? `Looking up ${registration}` : null}
              pending="Added in step 2"
            />
            {activeRoutes.length > 1 ? (
              <SummaryItem label="Route" value={step === 'confirm' ? (route?.name ?? null) : null} pending="Confirmed in step 3" />
            ) : null}
            <SummaryItem
              label="Corridor"
              value={
                step === 'confirm'
                  ? [originCountry, registrationCountry, destinationCountry]
                      .filter((c, i, all) => c !== all[i - 1])
                      .map(countryName)
                      .join(' → ')
                  : null
              }
              pending="Confirmed in step 3"
            />
            <SummaryItem label="Expected delivery" value={expectedDeliveryDate ? formatDate(expectedDeliveryDate) : null} pending="Confirmed in step 3" />
          </dl>
          <div className="new-job-next">
            <strong>What happens next</strong>
            <span>The job is created with status New and opens in its workspace, where you add tasks, files and notes.</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, pending }: { label: string; value: ReactNode; pending: string }) {
  return (
    <div className="new-job-summary-item">
      <dt>{label}</dt>
      <dd className={value ? 'is-set' : ''}>{value ?? pending}</dd>
    </div>
  );
}
