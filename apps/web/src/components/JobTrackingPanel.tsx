import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { JobTracking } from '../lib/tracking';
import { JourneyMap } from './JourneyMap';
import { fieldClass, primaryBtn, secondaryBtn } from './ui';

export function JobTrackingPanel({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const [trackerId, setTrackerId] = useState('');
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
  };

  const advance = useMutation({
    mutationFn: () => api(`/import-jobs/${jobId}/tracking/advance`, { method: 'POST' }),
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
      void invalidate();
    },
  });
  const unassign = useMutation({
    mutationFn: (assignmentId: string) =>
      api(`/trackers/assignments/${assignmentId}/unassign`, { method: 'POST' }),
    onSuccess: () => void invalidate(),
  });

  if (!tracking) {
    return <section className="rounded-2xl bg-paper p-4 text-sm text-ink/50">Loading GPS…</section>;
  }

  const current = tracking.current;
  const markers = current
    ? [
        {
          id: tracking.importJobId,
          latitude: current.latitude,
          longitude: current.longitude,
          heading: current.heading,
          label: `${tracking.vehicle.make ?? 'Vehicle'} ${tracking.vehicle.model ?? ''}`.trim(),
          sublabel: tracking.reference,
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
              ? `${current.latitude.toFixed(4)}, ${current.longitude.toFixed(4)} · ${formatDateTime(current.recordedAt)}`
              : 'No location events yet'}
            {current?.speed != null ? ` · ${Math.round(current.speed)} km/h` : ''}
          </p>
        </div>
        {tracking.tracker ? (
          <button
            type="button"
            className="rounded-full bg-harbour px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
            disabled={advance.isPending}
            onClick={() => advance.mutate()}
          >
            {advance.isPending ? 'Pinging…' : 'Advance GPS'}
          </button>
        ) : null}
      </div>
      <JourneyMap map={tracking.map} trail={tracking.trail} markers={markers} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {tracking.tracker ? (
          <p>
            Tracker <span className="font-semibold">{tracking.tracker.serialNumber}</span>
            {tracking.tracker.batteryLevel != null ? ` · ${tracking.tracker.batteryLevel}% battery` : ''}
          </p>
        ) : (
          <p className="text-ink/50">No tracker assigned</p>
        )}
        {tracking.tracker ? (
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
        ) : (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (trackerId) assign.mutate();
            }}
          >
            <select
            className={fieldClass}
              value={trackerId}
              onChange={(event) => setTrackerId(event.target.value)}
            >
              <option value="">Select tracker</option>
              {(tracking.availableTrackers ?? []).map((tracker) => (
                <option key={tracker.id} value={tracker.id}>
                  {tracker.serialNumber}
                  {tracker.batteryLevel != null ? ` (${tracker.batteryLevel}%)` : ''}
                </option>
              ))}
            </select>
            <button className={primaryBtn} type="submit" disabled={!trackerId}>
              Assign
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
