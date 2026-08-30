import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isDestinationReached, type LocationPoint } from '@vip/shared';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  FALLBACK_MAP,
  trackerKindLabel,
  type JobTracking,
  type RouteTemplateOption,
} from '../lib/tracking';
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
  const [suggestion, setSuggestion] = useState<{
    recommendedTemplateId: string;
    code: string;
    name: string;
    rationale: string;
    confidence: number;
  } | null>(null);
  const trackingQuery = useQuery({
    queryKey: ['tracking', jobId],
    queryFn: () => api<JobTracking>(`/import-jobs/${jobId}/tracking`),
    enabled: Boolean(jobId),
    refetchInterval: 5000,
  });
  const templatesQuery = useQuery({
    queryKey: ['route-templates'],
    queryFn: () => api<RouteTemplateOption[]>('/route-templates'),
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
  const assignRoute = useMutation({
    mutationFn: (routeTemplateId: string) =>
      api(`/import-jobs/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ routeTemplateId }),
      }),
    onSuccess: () => {
      setSuggestion(null);
      void invalidate();
    },
  });
  const suggestRoute = useMutation({
    mutationFn: () =>
      api<{
        recommendedTemplateId: string;
        code: string;
        name: string;
        rationale: string;
        confidence: number;
      }>(`/import-jobs/${jobId}/route-recommend`, { method: 'POST' }),
    onSuccess: (data) => setSuggestion(data),
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
  const plannedRoute = !arrived && tracking?.plannedRoute?.length ? tracking.plannedRoute : [];

  if (!tracking && !current) {
    return (
      <section className="rounded-2xl bg-paper p-4 text-sm text-ink/50">
        {trackingQuery.isError ? 'Could not load GPS.' : 'Loading GPS…'}
      </section>
    );
  }

  const markers = current
    ? [
        {
          id: tracking?.importJobId ?? jobId,
          latitude: current.latitude,
          longitude: current.longitude,
          heading: current.heading,
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
              : 'No GPS ping yet — planned route only until a tracker reports'}
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

      {templatesQuery.data && templatesQuery.data.length > 0 ? (
        <div className="rounded-xl bg-sand/60 px-3 py-3">
          <label className="block text-sm">
            <span className="font-semibold">Planned corridor</span>
            <span className="mt-0.5 block text-xs text-ink/55">
              Assign the UK → Bulgaria → Greece route this consignment will follow. Switch it when
              traffic or weather makes another corridor better.
            </span>
            <select
              className={`${fieldClass} mt-2`}
              disabled={!canWrite || assignRoute.isPending}
              value={tracking?.routeTemplate?.id ?? ''}
              onChange={(event) => {
                if (event.target.value) assignRoute.mutate(event.target.value);
              }}
            >
              <option value="" disabled>
                Select a corridor…
              </option>
              {templatesQuery.data.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {tracking?.routeTemplate?.description ? (
            <p className="mt-2 text-xs text-ink/55">{tracking.routeTemplate.description}</p>
          ) : null}
          {canWrite ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={secondaryBtn}
                disabled={suggestRoute.isPending}
                onClick={() => suggestRoute.mutate()}
              >
                {suggestRoute.isPending ? 'Suggesting…' : 'Suggest corridor'}
              </button>
              {suggestion &&
              suggestion.recommendedTemplateId !== tracking?.routeTemplate?.id ? (
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={assignRoute.isPending}
                  onClick={() => assignRoute.mutate(suggestion.recommendedTemplateId)}
                >
                  {assignRoute.isPending ? 'Applying…' : `Apply ${suggestion.name}`}
                </button>
              ) : null}
            </div>
          ) : null}
          {suggestion ? (
            <p className="mt-2 text-xs text-ink/65">
              <span className="font-semibold">{suggestion.name}</span>
              {` · ${Math.round(suggestion.confidence * 100)}% · ${suggestion.rationale}`}
            </p>
          ) : null}
          {suggestRoute.error instanceof Error ? (
            <div className="mt-2">
              <ErrorBanner message={suggestRoute.error.message} />
            </div>
          ) : null}
          {assignRoute.error instanceof Error ? (
            <div className="mt-2">
              <ErrorBanner message={assignRoute.error.message} />
            </div>
          ) : null}
        </div>
      ) : null}

      <JourneyMap
        key={jobId}
        map={map}
        trail={trail}
        markers={markers}
        plannedRoutes={plannedRoute.length > 1 ? [plannedRoute] : []}
      />
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {tracking?.tracker ? (
            <p>
              Tracker <span className="font-semibold">{tracking.tracker.serialNumber}</span>
              {' · '}
              {trackerKindLabel(tracking.tracker.provider)}
              {tracking.tracker.batteryLevel != null
                ? ` · ${tracking.tracker.batteryLevel}% battery`
                : ''}
            </p>
          ) : (
            <p className="text-ink/50">
              {tracking ? 'No tracker assigned' : 'Showing last known position'}
            </p>
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
          <select
            className={fieldClass}
            value={trackerId}
            onChange={(event) => onTrackerId(event.target.value)}
          >
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
        <select
          className={fieldClass}
          value={provider}
          onChange={(event) => onProvider(event.target.value)}
        >
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
