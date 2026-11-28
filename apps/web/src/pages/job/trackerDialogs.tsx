import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Dialog, RadioGroup, Select, Text, TextInput } from '@atomic-ui/ui-react';
import { needsFitter, type TrackerPowerSource } from '@vip/shared';
import { api } from '../../lib/api';
import { formatDate, relativeTime } from '../../lib/format';
import { trackerKindLabel, type JobTracking } from '../../lib/tracking';
import { TrackerQrScanButton } from '../../components/TrackerQrScanner';
import { TrackerDetailsFields, TrackerStatement } from '../../components/TrackerFields';
import { detailsBody, EMPTY_DETAILS, powerSourceName, statementBody, type TrackerDetails } from '../../lib/trackerDetails';

/** The demo simulator is not a real unit, so it needs no statement and no removal. */
const isSimulated = (provider: string) => ['generic', 'sim', 'demo'].includes(provider.trim().toLowerCase());

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
  const [details, setDetails] = useState<TrackerDetails>(EMPTY_DETAILS);
  const [confirmed, setConfirmed] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const available = (tracking.availableTrackers ?? []).map((t) => ({
    value: t.id,
    label: [t.serialNumber, trackerKindLabel(t.provider), t.batteryLevel == null ? null : `battery ${t.batteryLevel}%`].filter(Boolean).join(' · '),
  }));
  const registering = Boolean(imei.trim());
  const real = !isSimulated(provider);
  // A wired unit chosen from the list may still need its fitter and the owner's permission.
  const chosen = registering ? undefined : tracking.availableTrackers?.find((t) => t.id === trackerId);
  const unfitted = Boolean(chosen && !isSimulated(chosen.provider) && needsFitter(chosen.powerSource) && (!chosen.fittedBy || !chosen.ownerPermissionHeld));
  const [fitting, setFitting] = useState({ fittedBy: '', ownerPermissionHeld: false });
  const fittingDone = !unfitted || (fitting.fittedBy.trim() !== '' && fitting.ownerPermissionHeld);
  const ready = registering ? !real || confirmed : Boolean(trackerId) && fittingDone;

  const save = useMutation({
    mutationFn: async () => {
      let id = trackerId;
      if (registering) {
        const created = await api<{ id: string }>('/trackers', {
          method: 'POST',
          body: JSON.stringify({ serialNumber: imei.trim(), provider, ...detailsBody(details), ...(real ? statementBody(confirmed) : {}) }),
        });
        id = created.id;
      } else if (unfitted) {
        await api(`/trackers/${id}`, { method: 'PATCH', body: JSON.stringify({ fittedBy: fitting.fittedBy.trim(), ownerPermissionHeld: true }) });
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
          if (ready) save.mutate();
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
        {unfitted && chosen ? (
          <>
            <Text size="sm">{`${chosen.serialNumber} is ${powerSourceName(chosen.powerSource).toLowerCase()}. Record who fits it before it goes on this job.`}</Text>
            <TextInput label="Fitter" value={fitting.fittedBy} onChange={(e) => setFitting((f) => ({ ...f, fittedBy: e.detail.value }))} />
            <Checkbox
              label="We hold the vehicle owner’s written permission to fit this unit"
              checked={fitting.ownerPermissionHeld}
              onChange={(e) => setFitting((f) => ({ ...f, ownerPermissionHeld: Boolean(e.detail.value) }))}
            />
          </>
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
        {registering ? (
          <>
            <Select label="Provider" options={PROVIDERS} value={provider} onChange={(e) => setProvider(e.detail.value)} />
            {real ? (
              <>
                <TrackerDetailsFields value={details} onChange={setDetails} />
                <TrackerStatement powerSource={details.powerSource} confirmed={confirmed} onChange={setConfirmed} />
              </>
            ) : null}
          </>
        ) : null}
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
          <Button type="submit" disabled={!ready} busy={save.isPending} busyLabel="Saving the tracker">
            {current ? 'Replace tracker' : 'Assign tracker'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Asks whether a real unit is out of the vehicle, and for a hard-wired or
 * diagnostic-port unit, the fitter who took it out. Used when a unit comes off
 * a job, and later to confirm a removal that was left open.
 */
function RemovalQuestion({
  powerSource,
  removed,
  fitter,
  onRemoved,
  onFitter,
  allowLater,
}: {
  powerSource: TrackerPowerSource;
  removed: boolean;
  fitter: string;
  onRemoved: (removed: boolean) => void;
  onFitter: (fitter: string) => void;
  allowLater: boolean;
}) {
  const wired = needsFitter(powerSource);
  return (
    <>
      {allowLater ? (
        <RadioGroup
          label="Is the unit out of the vehicle?"
          value={removed ? 'yes' : 'later'}
          options={[
            { value: 'yes', label: wired ? 'Yes, the fitter has taken it out and restored the wiring' : 'Yes, it has been taken out' },
            { value: 'later', label: 'Not yet', description: 'The job stays flagged on the Board until someone confirms it.' },
          ]}
          onChange={(event) => onRemoved(event.detail.value === 'yes')}
        />
      ) : null}
      {removed && wired ? <TextInput label="Fitter who took it out" value={fitter} onChange={(event) => onFitter(event.detail.value)} /> : null}
    </>
  );
}

/** Take the tracker off the job. The trail it recorded is kept. */
export function RemoveTrackerDialog({ jobId, tracking, onClose }: { jobId: string; tracking: JobTracking; onClose: () => void }) {
  const refresh = useTrackingRefresh(jobId);
  const tracker = tracking.tracker!;
  const real = !isSimulated(tracker.provider);
  const [removed, setRemoved] = useState(false);
  const [fitter, setFitter] = useState('');
  const needsName = removed && needsFitter(tracker.powerSource) && !fitter.trim();
  const remove = useMutation({
    mutationFn: () =>
      api(`/trackers/assignments/${tracker.assignmentId}/unassign`, {
        method: 'POST',
        body: JSON.stringify(real ? { unitRemoved: removed, removalFitter: fitter.trim() || undefined } : {}),
      }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  return (
    <Dialog open heading="Remove the tracker?" onClose={onClose}>
      <div className="job-dialog">
        <p className="job-dialog-lead">{`${tracker.serialNumber} comes off this job and becomes available again. The trail it recorded is kept.`}</p>
        {real ? (
          <RemovalQuestion powerSource={tracker.powerSource} removed={removed} fitter={fitter} onRemoved={setRemoved} onFitter={setFitter} allowLater />
        ) : null}
        {remove.isError ? (
          <Alert tone="danger" heading="The tracker was not removed">
            {remove.error instanceof Error ? remove.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" disabled={needsName} busy={remove.isPending} busyLabel="Removing the tracker" onClick={() => remove.mutate()}>
            Remove tracker
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Confirms that a unit that came off this job has been taken out of the vehicle. */
export function ConfirmRemovalDialog({
  jobId,
  removal,
  onClose,
}: {
  jobId: string;
  removal: NonNullable<JobTracking['pendingRemovals']>[number];
  onClose: () => void;
}) {
  const refresh = useTrackingRefresh(jobId);
  const [fitter, setFitter] = useState('');
  const wired = needsFitter(removal.powerSource);
  const confirm = useMutation({
    mutationFn: () =>
      api(`/trackers/assignments/${removal.assignmentId}/confirm-removal`, {
        method: 'POST',
        body: JSON.stringify({ unitRemoved: true, removalFitter: fitter.trim() || undefined }),
      }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  return (
    <Dialog open heading="Confirm the unit was taken out" onClose={onClose}>
      <div className="job-dialog">
        <p className="job-dialog-lead">
          {`${removal.serialNumber} (${powerSourceName(removal.powerSource).toLowerCase()}) came off this job on ${formatDate(removal.removedAt)}. Confirm only once it is out of the vehicle${wired ? ' and the wiring is restored' : ''}.`}
        </p>
        <RemovalQuestion powerSource={removal.powerSource} removed fitter={fitter} onRemoved={() => undefined} onFitter={setFitter} allowLater={false} />
        {confirm.isError ? (
          <Alert tone="danger" heading="The removal was not confirmed">
            {confirm.error instanceof Error ? confirm.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={wired && !fitter.trim()} busy={confirm.isPending} busyLabel="Confirming the removal" onClick={() => confirm.mutate()}>
            It has been taken out
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Changes how the job's unit is powered, fitted or set to report. */
export function TrackerSettingsDialog({ jobId, tracking, onClose }: { jobId: string; tracking: JobTracking; onClose: () => void }) {
  const refresh = useTrackingRefresh(jobId);
  const tracker = tracking.tracker!;
  const [details, setDetails] = useState<TrackerDetails>({
    powerSource: tracker.powerSource,
    reportIntervalMinutes: tracker.reportIntervalMinutes,
    fittedBy: tracker.fittedBy ?? '',
    ownerPermissionHeld: tracker.ownerPermissionHeld,
  });
  const save = useMutation({
    mutationFn: () => api(`/trackers/${tracker.id}`, { method: 'PATCH', body: JSON.stringify(detailsBody(details)) }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  return (
    <Dialog open heading={`Settings for ${tracker.serialNumber}`} onClose={onClose}>
      <form
        className="job-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Text size="sm" tone="muted">
          Match the reporting interval to the unit’s own setting, so Harbour knows when it has gone quiet.
        </Text>
        <TrackerDetailsFields value={details} onChange={setDetails} />
        {save.isError ? (
          <Alert tone="danger" heading="The settings were not saved">
            {save.error instanceof Error ? save.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending} busyLabel="Saving the settings">
            Save settings
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
