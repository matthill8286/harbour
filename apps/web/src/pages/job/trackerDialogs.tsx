import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Dialog, Select, TextInput } from '@atomic-ui/ui-react';
import { api } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { trackerKindLabel, type JobTracking } from '../../lib/tracking';
import { TrackerQrScanButton } from '../../components/TrackerQrScanner';

const PROVIDERS = [
  { value: 'flespi', label: 'Teltonika / Flespi' },
  { value: 'generic', label: 'Demo simulator' },
];

/** Refresh everything a tracker change touches: the job, its tracking, the fleet map and the trackers list. */
function useTrackingRefresh(jobId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tracking', jobId] }),
      queryClient.invalidateQueries({ queryKey: ['tracking-live'] }),
      queryClient.invalidateQueries({ queryKey: ['job', jobId] }),
      queryClient.invalidateQueries({ queryKey: ['trackers'] }),
    ]);
  };
}

/**
 * Assign a tracker to the job, or replace the one it has, after the Figma dialog
 * "Replace tracker". Pick an available unit, or register a new one by its IMEI,
 * typed or scanned from the QR code on the sticker.
 */
export function TrackerDialog({ jobId, reference, tracking, onClose }: { jobId: string; reference: string; tracking: JobTracking; onClose: () => void }) {
  const refresh = useTrackingRefresh(jobId);
  const current = tracking.tracker;
  const [trackerId, setTrackerId] = useState('');
  const [imei, setImei] = useState('');
  const [provider, setProvider] = useState('flespi');
  const [scanError, setScanError] = useState<string | null>(null);
  const available = (tracking.availableTrackers ?? []).map((t) => ({
    value: t.id,
    label: [t.serialNumber, trackerKindLabel(t.provider), t.batteryLevel == null ? null : `battery ${t.batteryLevel}%`].filter(Boolean).join(' · '),
  }));
  const registering = Boolean(imei.trim());

  const save = useMutation({
    mutationFn: async () => {
      let id = trackerId;
      if (registering) {
        const created = await api<{ id: string }>('/trackers', { method: 'POST', body: JSON.stringify({ serialNumber: imei.trim(), provider }) });
        id = created.id;
      }
      await api(`/trackers/jobs/${jobId}/assign`, { method: 'POST', body: JSON.stringify({ trackerId: id }) });
    },
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  return (
    <Dialog open heading={current ? 'Replace the tracker on this job' : 'Assign a tracker'} onClose={onClose}>
      <form
        className="job-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (trackerId || registering) save.mutate();
        }}
      >
        {current ? (
          <p className="job-dialog-lead">
            {`${reference} uses ${current.serialNumber} (battery ${current.batteryLevel == null ? 'unknown' : `${current.batteryLevel}%`}, last seen ${relativeTime(current.lastSeenAt).toLowerCase()}). The old unit becomes available again and the route carries on.`}
          </p>
        ) : null}
        {available.length > 0 ? (
          <Select
            label={current ? 'New tracker' : 'Tracker'}
            placeholder="Choose an available unit"
            options={available}
            value={trackerId}
            disabled={registering}
            onChange={(e) => setTrackerId(e.detail.value)}
          />
        ) : null}
        <div className="job-dialog-scan">
          <TextInput
            label={available.length > 0 ? 'Or register a new unit by IMEI' : 'IMEI of the new unit'}
            placeholder="IMEI from the TAT140 sticker"
            inputmode="numeric"
            autocomplete="off"
            value={imei}
            onChange={(e) => setImei(e.detail.value)}
          />
          <TrackerQrScanButton
            label="Scan QR"
            disabled={save.isPending}
            onImei={(value) => {
              setScanError(null);
              setImei(value);
            }}
            onError={setScanError}
          />
        </div>
        {registering ? <Select label="Provider" options={PROVIDERS} value={provider} onChange={(e) => setProvider(e.detail.value)} /> : null}
        {scanError ? (
          <Alert tone="danger" heading="The QR code could not be read">
            {scanError}
          </Alert>
        ) : null}
        {save.isError ? (
          <Alert tone="danger" heading={current ? 'The tracker was not replaced' : 'The tracker was not assigned'}>
            {save.error instanceof Error ? save.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trackerId && !registering} busy={save.isPending} busyLabel="Saving the tracker">
            {current ? 'Replace tracker' : 'Assign tracker'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Take the tracker off the job. The trail it recorded is kept. */
export function RemoveTrackerDialog({ jobId, tracking, onClose }: { jobId: string; tracking: JobTracking; onClose: () => void }) {
  const refresh = useTrackingRefresh(jobId);
  const tracker = tracking.tracker!;
  const remove = useMutation({
    mutationFn: () => api(`/trackers/assignments/${tracker.assignmentId}/unassign`, { method: 'POST' }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  return (
    <Dialog open heading="Remove the tracker?" onClose={onClose}>
      <div className="job-dialog">
        <p className="job-dialog-lead">{`${tracker.serialNumber} comes off this job and becomes available again. The trail it recorded is kept.`}</p>
        {remove.isError ? (
          <Alert tone="danger" heading="The tracker was not removed">
            {remove.error instanceof Error ? remove.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" busy={remove.isPending} busyLabel="Removing the tracker" onClick={() => remove.mutate()}>
            Remove tracker
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
