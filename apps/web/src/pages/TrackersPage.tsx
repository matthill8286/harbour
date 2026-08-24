import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { formatDateTime, relativeTime } from '../lib/format';
import { trackerKindLabel } from '../lib/tracking';
import { Card, EmptyState, ErrorBanner, PageHeader, fieldClass, primaryBtn } from '../components/ui';

type InventoryTracker = {
  id: string;
  serialNumber: string;
  provider: string;
  status: string;
  batteryLevel: number | null;
  lastSeenAt: string | null;
  assignments: Array<{
    importJob: { id: string; reference: string } | null;
  }>;
};

export function TrackersPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ serialNumber: '', provider: 'flespi' });
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['trackers'],
    queryFn: () => api<InventoryTracker[]>('/trackers'),
  });
  const create = useMutation({
    mutationFn: () =>
      api('/trackers', {
        method: 'POST',
        body: JSON.stringify({
          serialNumber: form.serialNumber.trim(),
          provider: form.provider,
        }),
      }),
    onSuccess: () => {
      setForm({ serialNumber: '', provider: 'flespi' });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['trackers'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Unable to register tracker');
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Hardware"
        title="Trackers"
        description="Register the IMEI from the TAT140 sticker. The Flespi stream must already post into Harbour. Do not put a live Teltonika unit on the same job as demo tracker TRK-001 — replace the demo unit first or the map and job status will disagree."
      />
      <Card className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          className={fieldClass}
          placeholder="IMEI"
          value={form.serialNumber}
          onChange={(event) => setForm({ ...form, serialNumber: event.target.value })}
          autoComplete="off"
        />
        <select
          className={fieldClass}
          value={form.provider}
          onChange={(event) => setForm({ ...form, provider: event.target.value })}
        >
          <option value="flespi">Teltonika / Flespi</option>
          <option value="generic">Demo simulator</option>
        </select>
        <button
          type="button"
          className={primaryBtn}
          disabled={!form.serialNumber.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Saving…' : 'Register unit'}
        </button>
        {error ? (
          <div className="sm:col-span-3">
            <ErrorBanner message={error} />
          </div>
        ) : null}
      </Card>
      {!isLoading && (data ?? []).length === 0 ? (
        <EmptyState
          title="No trackers yet"
          description="Add a TAT140 IMEI here, then assign it from the job’s Live GPS panel."
        />
      ) : (
        <ul className="space-y-2">
          {(data ?? []).map((tracker) => {
            const job = tracker.assignments[0]?.importJob;
            return (
              <li key={tracker.id} className="rounded-2xl bg-paper p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{tracker.serialNumber}</p>
                    <p className="text-sm text-ink/60">
                      {trackerKindLabel(tracker.provider)} · {tracker.status.toLowerCase()}
                      {tracker.batteryLevel != null ? ` · ${tracker.batteryLevel}% battery` : ''}
                    </p>
                    <p className="mt-1 text-xs text-ink/50">
                      {tracker.lastSeenAt
                        ? `Last seen ${formatDateTime(tracker.lastSeenAt)} (${relativeTime(tracker.lastSeenAt)})`
                        : 'No ping yet'}
                    </p>
                  </div>
                  {job ? (
                    <Link to={`/jobs/${job.id}`} className="text-sm font-semibold text-harbour">
                      {job.reference}
                    </Link>
                  ) : (
                    <span className="text-sm text-ink/50">Unassigned</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
