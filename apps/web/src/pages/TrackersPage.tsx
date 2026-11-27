import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, Dialog, EmptyState, FilterChip, Heading, Icon, Row, Select, Table, Text, TextInput } from '@atomic-ui/ui-react';
import { api, ApiError } from '../lib/api';
import { formatDate, relativeTime } from '../lib/format';
import { trackerKindLabel } from '../lib/tracking';
import { useSession } from '../lib/session';
import { openRowLink } from '../lib/tableRows';
import { TrackerQrScanButton } from '../components/TrackerQrScanner';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import './fleet/Fleet.css';

type TrackerStatus = 'AVAILABLE' | 'ASSIGNED' | 'OFFLINE' | 'RETIRED';

type InventoryTracker = {
  id: string;
  serialNumber: string;
  provider: string;
  status: TrackerStatus;
  batteryLevel: number | null;
  lastSeenAt: string | null;
  assignments: Array<{ importJob: { id: string; reference: string } | null }>;
};

const STATUS_LABEL: Record<TrackerStatus, string> = {
  ASSIGNED: 'Assigned',
  AVAILABLE: 'Available',
  OFFLINE: 'Offline',
  RETIRED: 'Retired',
};
const STATUS_TONE: Record<TrackerStatus, 'solid' | 'neutral' | 'danger'> = {
  ASSIGNED: 'solid',
  AVAILABLE: 'neutral',
  OFFLINE: 'danger',
  RETIRED: 'neutral',
};

/** The phone list's filters, after the Figma frame "Mobile · Trackers". */
const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  {
    key: 'assigned',
    label: 'Assigned',
    match: (t: InventoryTracker) => t.status === 'ASSIGNED',
  },
  {
    key: 'free',
    label: 'Free',
    match: (t: InventoryTracker) => t.status === 'AVAILABLE',
  },
  {
    key: 'silent',
    label: 'Silent',
    match: (t: InventoryTracker) => t.status === 'OFFLINE',
  },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const COLUMNS = [
  { key: 'imei', label: 'Unit' },
  { key: 'provider', label: 'Provider' },
  { key: 'status', label: 'Status' },
  { key: 'job', label: 'Assigned to' },
  { key: 'ping', label: 'Last ping' },
  { key: 'battery', label: 'Battery' },
];

const PROVIDERS = [
  { value: 'flespi', label: 'Teltonika / Flespi' },
  { value: 'generic', label: 'Demo simulator' },
];

/** Battery at or below this is shown in the danger colour. */
const LOW_BATTERY = 15;

function lastPing(tracker: InventoryTracker) {
  if (!tracker.lastSeenAt) return 'No ping yet';
  return tracker.status === 'RETIRED' ? formatDate(tracker.lastSeenAt) : relativeTime(tracker.lastSeenAt);
}

function Battery({ level }: { level: number | null }) {
  if (level == null) return <span aria-label="Battery unknown">—</span>;
  const low = level <= LOW_BATTERY;
  return (
    <span className={`fleet-battery${low ? ' is-low' : ''}`}>
      <span className="fleet-battery-bar" aria-hidden="true">
        <span style={{ inlineSize: `${Math.max(0, Math.min(100, level))}%` }} />
      </span>
      {`${level}%`}
    </span>
  );
}

/** The form that registers a unit, on the page on a desktop and in a sheet on a phone. */
function RegisterForm({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ serialNumber: '', provider: 'flespi' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api('/trackers', {
        method: 'POST',
        body: JSON.stringify({
          serialNumber: form.serialNumber.trim(),
          provider: form.provider,
        }),
      }),
    onSuccess: async () => {
      setForm((f) => ({ ...f, serialNumber: '' }));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['trackers'] });
      onDone?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'The unit was not registered. Try again.'),
  });

  return (
    <form
      className="fleet-register"
      onSubmit={(event) => {
        event.preventDefault();
        if (form.serialNumber.trim()) create.mutate();
      }}
    >
      <TextInput
        label="IMEI"
        autocomplete="off"
        inputmode="numeric"
        placeholder="IMEI from the TAT140 sticker"
        value={form.serialNumber}
        onChange={(event) => {
          const value = event.detail.value;
          setForm((f) => ({ ...f, serialNumber: value }));
        }}
      />
      <div className="fleet-register-scan">
        <TrackerQrScanButton
          onImei={(imei) => {
            setForm((f) => ({ ...f, serialNumber: imei }));
            setError(null);
          }}
          onError={setError}
          disabled={create.isPending}
        />
      </div>
      <Select
        label="Provider"
        options={PROVIDERS}
        value={form.provider}
        onChange={(event) => {
          const value = event.detail.value;
          setForm((f) => ({ ...f, provider: value }));
        }}
      />
      <Button type="submit" disabled={!form.serialNumber.trim()} busy={create.isPending} busyLabel="Registering the unit">
        Register unit
      </Button>
      {error ? (
        <Alert tone="danger" heading="The unit was not registered" className="fleet-register-error">
          {error}
        </Alert>
      ) : null}
    </form>
  );
}

/**
 * Trackers, after the Figma frames "Business · Trackers": register a GPS unit by
 * IMEI or QR, and see every unit with its job, last ping and battery.
 */
export function TrackersPage() {
  const { canWrite } = useSession();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sheet, setSheet] = useState(false);
  const query = useQuery({
    queryKey: ['trackers'],
    queryFn: () => api<InventoryTracker[]>('/trackers'),
  });
  const trackers = query.data ?? [];
  const shown = trackers.filter(FILTERS.find((f) => f.key === filter)!.match);
  const devices = (n: number) => `${n} ${n === 1 ? 'device' : 'devices'}`;

  return (
    <div className="fleet">
      <PhoneHeader>
        <div className="fleet-phone-head">
          <div>
            <Heading level={1} size="3xl">
              Trackers
            </Heading>
            <Text size="sm">{query.data ? devices(trackers.length) : ' '}</Text>
          </div>
          {canWrite ? <Button icon="plus" label="Register a tracker" onClick={() => setSheet(true)} /> : null}
        </div>
      </PhoneHeader>

      <div className="fleet-heading">
        <Heading level={1} size="4xl">
          Trackers
        </Heading>
        <Text tone="muted">GPS units owned by this workspace. A unit is assigned to one job at a time.</Text>
      </div>

      {canWrite ? (
        <Card className="fleet-card fleet-register-card">
          <Heading level={2} size="md">
            Register a unit
          </Heading>
          <Text size="sm" tone="muted">
            Keep live Teltonika devices and the demo simulator off the same job.
          </Text>
          <RegisterForm />
        </Card>
      ) : null}

      {query.isLoading ? (
        <LoadingScreen label="Loading trackers…" />
      ) : query.isError ? (
        <Alert tone="danger" heading="Trackers could not load">
          Check your connection, then try again.
          <div className="job-retry">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : trackers.length === 0 ? (
        <EmptyState
          heading="No trackers yet"
          lead={
            canWrite
              ? 'This workspace has no GPS units registered yet. Register the first one by IMEI or QR.'
              : 'This workspace has no GPS units registered yet.'
          }
          framed
        />
      ) : (
        <>
          <Card className="fleet-card fleet-desktop" padding="sm">
            <Table
              className="fleet-table"
              caption="Trackers"
              columns={COLUMNS}
              rows={trackers.map((t) => {
                const job = t.assignments[0]?.importJob;
                return {
                  id: t.id,
                  imei: t.serialNumber,
                  provider: trackerKindLabel(t.provider),
                  status: STATUS_LABEL[t.status],
                  job: job?.reference ?? 'Unassigned',
                  ping: lastPing(t),
                  battery: t.batteryLevel == null ? '—' : `${t.batteryLevel}%`,
                };
              })}
              onClick={(event) => openRowLink(event, navigate)}
            >
              {trackers.flatMap((t) => {
                const job = t.assignments[0]?.importJob;
                return [
                  <Badge key={`${t.id}-status`} slot={`cell:${t.id}:status`} tone={STATUS_TONE[t.status]}>
                    {STATUS_LABEL[t.status]}
                  </Badge>,
                  job ? (
                    <a key={`${t.id}-job`} slot={`cell:${t.id}:job`} className="fleet-link" href={`/jobs/${job.id}?tab=tracking`}>
                      {job.reference}
                    </a>
                  ) : null,
                  <span key={`${t.id}-battery`} slot={`cell:${t.id}:battery`}>
                    <Battery level={t.batteryLevel} />
                  </span>,
                ];
              })}
            </Table>
          </Card>

          <div className="fleet-chips fleet-phone" role="group" aria-label="Filter trackers">
            {FILTERS.map((f) => {
              const count = trackers.filter(f.match).length;
              return (
                <FilterChip
                  key={f.key}
                  label={f.label}
                  count={count}
                  countLabel={devices(count)}
                  pressed={filter === f.key}
                  onChange={(event) => {
                    (event.currentTarget as HTMLElement & { pressed: boolean }).pressed = true;
                    setFilter(f.key);
                  }}
                />
              );
            })}
          </div>

          <Card className="fleet-card fleet-phone">
            {shown.length === 0 ? (
              <Text tone="muted">No trackers in this group.</Text>
            ) : (
              <div role="list">
                {shown.map((t, index) => {
                  const job = t.assignments[0]?.importJob;
                  const battery = t.batteryLevel == null ? 'Battery unknown' : `Battery ${t.batteryLevel}%`;
                  return (
                    <Row
                      key={t.id}
                      role="listitem"
                      divided={index > 0}
                      heading={job ? `${t.serialNumber} · ${job.reference}` : t.serialNumber}
                      meta={`${battery} · ${lastPing(t)}`}
                      href={job ? `/jobs/${job.id}?tab=tracking` : undefined}
                    >
                      <Icon slot="start" name="radio" className={t.status === 'OFFLINE' ? 'fleet-silent' : undefined} />
                      <Badge slot="end" tone={STATUS_TONE[t.status]}>
                        {t.status === 'OFFLINE' ? 'Silent' : t.status === 'AVAILABLE' ? 'Free' : STATUS_LABEL[t.status]}
                      </Badge>
                    </Row>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      {sheet ? (
        <Dialog open heading="Register a tracker" phoneFullScreen onClose={() => setSheet(false)}>
          <Text size="sm" tone="muted">
            Adds a GPS unit to this workspace. Scan the QR on the sticker, or type the details.
          </Text>
          <RegisterForm onDone={() => setSheet(false)} />
        </Dialog>
      ) : null}
    </div>
  );
}
