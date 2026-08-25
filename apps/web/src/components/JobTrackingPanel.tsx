import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isDestinationReached, corridorPositionForStatus, type LocationPoint } from '@vip/shared';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { FALLBACK_MAP, trackerKindLabel, type JobTracking } from '../lib/tracking';
import { JourneyMap } from './JourneyMap';
import { TrackerQrScanButton } from './TrackerQrScanner';
import { ErrorBanner, fieldClass, primaryBtn, secondaryBtn } from './ui';
import { useSession } from '../lib/session';

export function JobTrackingPanel({
  jobId,
  lastKnown = null,
}: {
  jobId: string;
  lastKnown?: LocationPoint | null;
}) {
  const { canWrite } = useSession();
  const queryClient = useQueryClient();
  const [trackerId, setTrackerId] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [imei, setImei] = useState('');
  const [provider, setProvider] = useState('flespi');
  const trackingQuery = useQuery({
    queryKey: ['tracking', jobId],
    queryFn: () => api<JobTracking>(`/import-jobs/${jobId}/tracking`),
    enabled: Boolean(jobId),
    refetchInterval: 5000,
  });
  const tracking = trackingQuery.data;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tracking', jobId] });
    await queryClient.invalidateQueries({ queryKey: ['tracking-live'] });
    await queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    await queryClient.invalidateQueries({ queryKey: ['trackers'] });
  };

  const advance = useMutation({
    mutationFn: () => api(`/import-jobs/${jobId}/tracking/advance`, { method: 'POST' }),
    onSuccess: () => void invalidate(),
  });
  const sync = useMutation({
    mutationFn: () => api(`/trackers/${tracking!.tracker!.id}/sync`, { method: 'POST' }),
    onSuccess: () => void invalidate(),
  });
  const assign = useMutation({
    mutationFn: () =>
      api(`/trackers/jobs/${jobId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ trackerId }),
      }),
    onSuccess: () => {
      setTrackerId('');
      setReplacing(false);
      void invalidate();
    },
  });
  const registerAndAssign = useMutation({
    mutationFn: async () => {
      const created = await api<{ id: string }>('/trackers', {
        method: 'POST',
        body: JSON.stringify({ serialNumber: imei.trim(), provider }),
      });
      await api(`/trackers/jobs/${jobId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ trackerId: created.id }),
      });
    },
    onSuccess: () => {
      setImei('');
      setProvider('flespi');
      setReplacing(false);
      void invalidate();
    },
  });
  const unassign = useMutation({
    mutationFn: (assignmentId: string) =>
      api(`/trackers/assignments/${assignmentId}/unassign`, { method: 'POST' }),
    onSuccess: () => void invalidate(),
  });

  const current = tracking?.current ?? lastKnown ?? null;
  const trail = tracking?.trail?.length ? tracking.trail : current ? [current] : [];
  const map = tracking?.map ?? FALLBACK_MAP;
  const arrived = tracking ? isDestinationReached(tracking.status) : false;
  const plotted = current ?? (tracking ? corridorPositionForStatus(tracking.status) : null);

  if (!tracking && !current) {
    return (
      <section className="rounded-2xl bg-paper p-4 text-sm text-ink/50">
        {trackingQuery.isError ? 'Could not load GPS.' : 'Loading GPS…'}
      </section>
    );
  }

  const markers = plotted
    ? [
        {
          id: tracking?.importJobId ?? jobId,
          latitude: plotted.latitude,
          longitude: plotted.longitude,
          heading: current?.heading,
          estimated: !current,
          status: tracking?.status,
          label: `${tracking?.vehicle.make ?? 'Vehicle'} ${tracking?.vehicle.model ?? ''}`.trim(),
          sublabel: tracking?.reference,
        },
      ]
    : [];

  return (
    <section className="space-y-3 rounded-2xl bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="display text-2xl">Live GPS</h2>
          <p className="text-sm text-ink/60">
            {current
              ? `${Number(current.latitude).toFixed(4)}, ${Number(current.longitude).toFixed(4)} · ${formatDateTime(current.recordedAt)}`
              : 'No GPS ping yet — showing the planned corridor from this job’s status'}
            {current?.speed != null ? ` · ${Math.round(current.speed)} km/h` : ''}
          </p>
        </div>
        {canWrite && tracking?.tracker && tracking.tracker.provider === 'generic' ? (
          <button
            type="button"
            className="rounded-full bg-harbour px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
            disabled={advance.isPending}
            onClick={() => advance.mutate()}
          >
            {advance.isPending ? 'Pinging…' : 'Advance GPS'}
          </button>
        ) : null}
        {canWrite && tracking?.tracker?.provider === 'flespi' ? (
          <button
            type="button"
            className="rounded-full bg-harbour px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? 'Pulling…' : 'Pull from Flespi'}
          </button>
        ) : null}
      </div>
      <JourneyMap
        key={jobId}
        map={map}
        trail={trail}
        markers={markers}
        showPlannedRoute={!arrived}
      />
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {tracking?.tracker ? (
            <p>
              Tracker <span className="font-semibold">{tracking.tracker.serialNumber}</span>
              {' · '}
              {trackerKindLabel(tracking.tracker.provider)}
              {tracking.tracker.batteryLevel != null ? ` · ${tracking.tracker.batteryLevel}% battery` : ''}
            </p>
          ) : (
            <p className="text-ink/50">{tracking ? 'No tracker assigned' : 'Showing last known position'}</p>
          )}
          {canWrite && tracking?.tracker ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => setReplacing((open) => !open)}
              >
                {replacing ? 'Cancel replace' : 'Replace'}
              </button>
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => {
                  if (window.confirm('Remove this tracker from the job? The trail is kept.')) {
                    unassign.mutate(tracking.tracker!.assignmentId);
                  }
                }}
              >
                Unassign
              </button>
            </div>
          ) : null}
        </div>
        {canWrite && tracking && (!tracking.tracker || replacing) ? (
          <TrackerAssignForm
            available={tracking.availableTrackers ?? []}
            trackerId={trackerId}
            imei={imei}
            provider={provider}
            pending={assign.isPending || registerAndAssign.isPending}
            error={
              assign.error instanceof Error
                ? assign.error.message
                : registerAndAssign.error instanceof Error
                  ? registerAndAssign.error.message
                  : null
            }
            submitLabel={tracking.tracker ? 'Replace' : 'Assign'}
            onTrackerId={setTrackerId}
            onImei={setImei}
            onProvider={setProvider}
            onAssignExisting={() => assign.mutate()}
            onRegister={() => registerAndAssign.mutate()}
          />
        ) : null}
      </div>
    </section>
  );
}

function TrackerAssignForm({
  available,
  trackerId,
  imei,
  provider,
  pending,
  error,
  submitLabel,
  onTrackerId,
  onImei,
  onProvider,
  onAssignExisting,
  onRegister,
}: {
  available: NonNullable<JobTracking['availableTrackers']>;
  trackerId: string;
  imei: string;
  provider: string;
  pending: boolean;
  error: string | null;
  submitLabel: string;
  onTrackerId: (value: string) => void;
  onImei: (value: string) => void;
  onProvider: (value: string) => void;
  onAssignExisting: () => void;
  onRegister: () => void;
}) {
  const [scanError, setScanError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {available.length > 0 ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (trackerId) onAssignExisting();
          }}
        >
          <select className={fieldClass} value={trackerId} onChange={(event) => onTrackerId(event.target.value)}>
            <option value="">Select tracker</option>
            {available.map((tracker) => (
              <option key={tracker.id} value={tracker.id}>
                {tracker.serialNumber}
                {` · ${trackerKindLabel(tracker.provider)}`}
                {tracker.batteryLevel != null ? ` (${tracker.batteryLevel}%)` : ''}
              </option>
            ))}
          </select>
          <button className={primaryBtn} type="submit" disabled={!trackerId || pending}>
            {pending ? 'Saving…' : submitLabel}
          </button>
        </form>
      ) : null}
      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (imei.trim()) onRegister();
        }}
      >
        <input
          className={fieldClass}
          placeholder={available.length > 0 ? 'Or register IMEI' : 'IMEI from TAT140 sticker'}
          value={imei}
          onChange={(event) => onImei(event.target.value)}
          autoComplete="off"
        />
        <TrackerQrScanButton
          label="Scan"
          disabled={pending}
          onImei={(value) => {
            setScanError(null);
            onImei(value);
          }}
          onError={setScanError}
        />
        <select className={fieldClass} value={provider} onChange={(event) => onProvider(event.target.value)}>
          <option value="flespi">Teltonika / Flespi</option>
          <option value="generic">Demo simulator</option>
        </select>
        <button className={primaryBtn} type="submit" disabled={!imei.trim() || pending}>
          {pending ? 'Saving…' : `${submitLabel} new unit`}
        </button>
      </form>
      {scanError ? <ErrorBanner message={scanError} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
    </div>
  );
}
