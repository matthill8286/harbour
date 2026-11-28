import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, EmptyState, Heading, Select, Text } from '@atomic-ui/ui-react';
import { describeMinutes, nearestRouteIndex, needsFitter, type LocationPoint } from '@vip/shared';
import { hasArrived } from '../../lib/workflows';
import { api } from '../../lib/api';
import { formatDate, formatDateTime, relativeTime } from '../../lib/format';
import { FALLBACK_MAP, trackerKindLabel, type JobTracking, type RouteTemplateOption } from '../../lib/tracking';
import { JourneyMap } from '../../components/JourneyMap';
import { LoadingScreen } from '../../components/ui';
import { useJobStatus } from './useJobStatus';
import { ConfirmRemovalDialog, RemoveTrackerDialog, TrackerDialog, TrackerSettingsDialog } from './trackerDialogs';
import { everyLabel, powerSourceName } from '../../lib/trackerDetails';
import type { JobDetail } from './types';
import './TrackingTab.css';

type Suggestion = { recommendedTemplateId: string; code: string; name: string; rationale: string; confidence: number };

/**
 * The Tracking tab, after the Figma frames "Job workspace · Tracking" and
 * "Tracking · No tracker": the map with the latest position, the tracker on the
 * vehicle, and the planned corridor.
 */
export function TrackingTab({ job, lastKnown }: { job: JobDetail; lastKnown: LocationPoint | null }) {
  const { editable } = useJobStatus(job);
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'tracker' | 'remove' | 'settings' | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const trackingQuery = useQuery({
    queryKey: ['tracking', job.id],
    queryFn: () => api<JobTracking>(`/import-jobs/${job.id}/tracking`),
  });
  const templatesQuery = useQuery({
    queryKey: ['route-templates'],
    queryFn: () => api<RouteTemplateOption[]>('/route-templates'),
  });
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['tracking', job.id] }), queryClient.invalidateQueries({ queryKey: ['job', job.id] })]);

  const advance = useMutation({ mutationFn: () => api(`/import-jobs/${job.id}/tracking/advance`, { method: 'POST' }), onSuccess: refresh });
  const pull = useMutation({ mutationFn: () => api(`/trackers/${trackingQuery.data!.tracker!.id}/sync`, { method: 'POST' }), onSuccess: refresh });
  const assignRoute = useMutation({
    mutationFn: (routeTemplateId: string) => api(`/import-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ routeTemplateId }) }),
    onSuccess: async () => {
      setSuggestion(null);
      await refresh();
    },
  });
  const suggest = useMutation({
    mutationFn: () => api<Suggestion>(`/import-jobs/${job.id}/route-recommend`, { method: 'POST' }),
    onSuccess: setSuggestion,
  });

  if (trackingQuery.isLoading) return <LoadingScreen label="Loading tracking…" />;
  if (trackingQuery.isError || !trackingQuery.data) {
    return (
      <Alert tone="danger" heading="Tracking could not load">
        Check your connection, then try again.
        <div className="job-retry">
          <Button variant="secondary" onClick={() => void trackingQuery.refetch()}>
            Try again
          </Button>
        </div>
      </Alert>
    );
  }

  const tracking = trackingQuery.data;
  const tracker = tracking.tracker;
  const current = tracking.current ?? lastKnown ?? null;
  const trail = tracking.trail?.length ? tracking.trail : current ? [current] : [];
  const arrived = hasArrived(job.route, tracking.status);
  const planned = !arrived && tracking.plannedRoute?.length > 1 ? tracking.plannedRoute : [];
  // The server judges silence by the unit's own reporting interval.
  const live = tracker?.signal.state === 'LIVE';
  const pendingRemovals = tracking.pendingRemovals ?? [];
  const confirmingRemoval = pendingRemovals.find((item) => item.assignmentId === confirming);
  const nextWaypoint = current && planned.length ? planned[Math.min(nearestRouteIndex(planned, current) + 1, planned.length - 1)]?.label : null;
  const vehicle = [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
  const legs = job.journeys.reduce<Record<string, number>>((count, leg) => ({ ...count, [leg.type]: (count[leg.type] ?? 0) + 1 }), {});
  const legSummary = Object.entries(legs)
    .map(([type, n]) => `${n} ${type.toLowerCase()}`)
    .join(' · ');
  const templates = (templatesQuery.data ?? []).map((t) => ({ value: t.id, label: t.name }));

  const corridor = (
    <Card className="job-card">
      <Heading level={2} size="md" className="job-card-title">
        Planned corridor
      </Heading>
      {templates.length > 0 ? (
        <Select
          label="Route"
          placeholder="Choose a corridor"
          options={templates}
          value={tracking.routeTemplate?.id ?? ''}
          disabled={!editable || assignRoute.isPending}
          onChange={(e) => {
            if (e.detail.value) assignRoute.mutate(e.detail.value);
          }}
          className="job-field"
        />
      ) : (
        <Text tone="muted">No corridors are set up in this workspace.</Text>
      )}
      {tracking.routeTemplate?.description ? (
        <Text size="sm" tone="muted">
          {tracking.routeTemplate.description}
        </Text>
      ) : null}
      <dl className="job-pairs">
        <div>
          <dt>Legs</dt>
          <dd>{legSummary || 'None yet'}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{planned.length ? planned[planned.length - 1].label : tracking.routeTemplate ? 'Reached' : 'Not planned'}</dd>
        </div>
      </dl>
      {suggestion ? (
        <div className="job-suggestion">
          <strong>{suggestion.name}</strong>
          <Text size="sm" tone="muted">{`${Math.round(suggestion.confidence * 100)}% sure · ${suggestion.rationale}`}</Text>
          {suggestion.recommendedTemplateId !== tracking.routeTemplate?.id && editable ? (
            <Button
              size="sm"
              busy={assignRoute.isPending}
              busyLabel="Applying the corridor"
              onClick={() => assignRoute.mutate(suggestion.recommendedTemplateId)}
            >
              {`Use ${suggestion.name}`}
            </Button>
          ) : (
            <Text size="sm">This is the corridor the job already uses.</Text>
          )}
        </div>
      ) : null}
      {editable ? (
        <Button variant="subtle" full busy={suggest.isPending} busyLabel="Suggesting a corridor" onClick={() => suggest.mutate()}>
          Suggest corridor
        </Button>
      ) : null}
      {suggest.isError || assignRoute.isError ? (
        <Alert tone="danger" heading={suggest.isError ? 'No corridor could be suggested' : 'The corridor did not change'}>
          {(suggest.error ?? assignRoute.error) instanceof Error ? (suggest.error ?? assignRoute.error)!.message : 'Try again.'}
        </Alert>
      ) : null}
    </Card>
  );

  const removalsCard =
    pendingRemovals.length > 0 ? (
      <Card className="job-card">
        <div className="job-card-head">
          <Heading level={2} size="md">
            Not confirmed removed
          </Heading>
          <Badge tone="danger">{String(pendingRemovals.length)}</Badge>
        </div>
        <Text size="sm" tone="muted">
          A unit left in a delivered vehicle tracks its next owner. Confirm each one once it is out of the vehicle.
        </Text>
        <ul className="job-removals" role="list">
          {pendingRemovals.map((item) => (
            <li key={item.assignmentId}>
              <span>
                <strong>{item.serialNumber}</strong>
                <Text size="sm" tone="muted">{`${powerSourceName(item.powerSource)} · off the job ${formatDate(item.removedAt)}`}</Text>
              </span>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(item.assignmentId)}>
                Confirm removed
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    ) : null;

  if (!tracker && !current) {
    return (
      <div className="job-tracking is-empty">
        <EmptyState
          heading="No tracker assigned"
          lead="The route is recorded once a tracker is assigned to this job. Put a unit in the vehicle, then assign it."
          framed
        >
          {editable ? (
            <Button slot="actions" onClick={() => setDialog('tracker')}>
              Assign tracker
            </Button>
          ) : null}
        </EmptyState>
        {removalsCard}
        {corridor}
        {dialog === 'tracker' ? <TrackerDialog jobId={job.id} reference={job.reference} tracking={tracking} onClose={() => setDialog(null)} /> : null}
        {confirmingRemoval ? <ConfirmRemovalDialog jobId={job.id} removal={confirmingRemoval} onClose={() => setConfirming(null)} /> : null}
      </div>
    );
  }

  return (
    <div className="job-tracking">
      <Card className="job-card job-map-card">
        <div className="job-card-head">
          <div>
            <Heading level={2} size="md">
              Live GPS
            </Heading>
            <Text size="sm" tone="muted">
              Position from the assigned tracker along the planned corridor
            </Text>
          </div>
          <div className="job-map-actions">
            {tracker?.lastSeenAt ? (
              <Badge tone={live ? 'solid' : 'danger'}>{`${live ? 'Live' : 'No signal'} · last report ${relativeTime(tracker.lastSeenAt).toLowerCase()}`}</Badge>
            ) : (
              <Badge>No ping yet</Badge>
            )}
            {editable && tracker?.provider === 'generic' ? (
              <Button variant="subtle" size="sm" busy={advance.isPending} busyLabel="Sending a ping" onClick={() => advance.mutate()}>
                Advance GPS
              </Button>
            ) : null}
            {editable && tracker?.provider === 'flespi' ? (
              <Button variant="subtle" size="sm" busy={pull.isPending} busyLabel="Pulling from Flespi" onClick={() => pull.mutate()}>
                Pull from Flespi
              </Button>
            ) : null}
          </div>
        </div>
        <div className="job-map">
          <JourneyMap
            key={job.id}
            map={tracking.map ?? FALLBACK_MAP}
            trail={trail}
            markers={
              current
                ? [{ id: job.id, latitude: current.latitude, longitude: current.longitude, heading: current.heading, label: vehicle, sublabel: job.reference }]
                : []
            }
            plannedRoutes={planned.length ? [planned] : []}
          />
        </div>
        <dl className="job-tiles">
          <div>
            <dt>{current && !live ? 'Last known position' : 'Last position'}</dt>
            <dd>{current ? `${Number(current.latitude).toFixed(3)}, ${Number(current.longitude).toFixed(3)}` : 'None yet'}</dd>
            {current ? (
              <Text size="sm" tone="muted">
                {`${live ? '' : 'Recorded '}${formatDateTime(current.recordedAt)}${current.source === 'MANUAL' ? ' · typed in by staff' : ''}`}
              </Text>
            ) : null}
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{current?.speed != null ? `${Math.round(current.speed)} km/h` : 'Unknown'}</dd>
          </div>
          <div>
            <dt>{tracker && needsFitter(tracker.powerSource) ? 'Vehicle battery' : 'Battery'}</dt>
            <dd>
              {tracker && needsFitter(tracker.powerSource)
                ? tracker.supplyVoltage != null
                  ? `${tracker.supplyVoltage.toFixed(1)} V`
                  : 'Unknown'
                : tracker?.batteryLevel != null
                  ? `${tracker.batteryLevel}%`
                  : 'Unknown'}
            </dd>
          </div>
          <div>
            <dt>Next waypoint</dt>
            <dd>{arrived ? 'Arrived' : (nextWaypoint ?? 'Not planned')}</dd>
          </div>
        </dl>
      </Card>

      <aside className="job-tracking-side" aria-label="Tracker and corridor">
        <Card className="job-card">
          <div className="job-card-head">
            <Heading level={2} size="md">
              {tracker ? 'Assigned tracker' : 'Tracker'}
            </Heading>
            {tracker ? <Badge tone="solid">Assigned</Badge> : <Badge>None</Badge>}
          </div>
          {tracker ? (
            <>
              <p className="job-tracker-name">{tracker.serialNumber}</p>
              <dl className="job-pairs">
                <div>
                  <dt>Provider</dt>
                  <dd>{trackerKindLabel(tracker.provider)}</dd>
                </div>
                <div>
                  <dt>Power</dt>
                  <dd>{powerSourceName(tracker.powerSource)}</dd>
                </div>
                <div>
                  <dt>Reports</dt>
                  <dd>{everyLabel(tracker.reportIntervalMinutes)}</dd>
                </div>
                {needsFitter(tracker.powerSource) ? (
                  <div>
                    <dt>Fitter</dt>
                    <dd>{tracker.fittedBy ?? 'Not recorded'}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Assigned</dt>
                  <dd>{formatDate(tracker.assignedAt)}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{relativeTime(tracker.lastSeenAt)}</dd>
                </div>
              </dl>
              <Text size="sm" tone="muted">
                {`No signal after ${describeMinutes(tracker.signal.noSignalAfterMinutes)} without a report. The IMEI is never shown in the customer portal.`}
              </Text>
            </>
          ) : (
            <Text tone="muted">The tracker was removed. The trail it recorded is kept on the map.</Text>
          )}
          {editable ? (
            <div className="job-two-buttons">
              <Button variant="secondary" onClick={() => setDialog('tracker')}>
                {tracker ? 'Replace' : 'Assign tracker'}
              </Button>
              {tracker ? (
                <Button variant="subtle" onClick={() => setDialog('remove')}>
                  Remove
                </Button>
              ) : null}
            </div>
          ) : null}
          {editable && tracker ? (
            <Button variant="ghost" size="sm" onClick={() => setDialog('settings')}>
              Tracker settings
            </Button>
          ) : null}
        </Card>
        {removalsCard}
        {corridor}
      </aside>

      {dialog === 'tracker' ? <TrackerDialog jobId={job.id} reference={job.reference} tracking={tracking} onClose={() => setDialog(null)} /> : null}
      {dialog === 'remove' && tracker ? <RemoveTrackerDialog jobId={job.id} tracking={tracking} onClose={() => setDialog(null)} /> : null}
      {dialog === 'settings' && tracker ? <TrackerSettingsDialog jobId={job.id} tracking={tracking} onClose={() => setDialog(null)} /> : null}
      {confirmingRemoval ? <ConfirmRemovalDialog jobId={job.id} removal={confirmingRemoval} onClose={() => setConfirming(null)} /> : null}
    </div>
  );
}
