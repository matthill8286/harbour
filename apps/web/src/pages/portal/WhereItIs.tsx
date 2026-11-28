import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Heading, Text } from '@atomic-ui/ui-react';
import { api } from '../../lib/api';
import { formatDate, formatDateTime, relativeTime } from '../../lib/format';
import { FALLBACK_MAP, type JobTracking } from '../../lib/tracking';
import { JourneyMap } from '../../components/JourneyMap';
import { countryName } from '../job/countries';
import { hasArrived, place, vehicleName, type PortalJob } from './portal';

const LEG_LABEL: Record<string, { text: string; tone: 'neutral' | 'solid' | 'inverse' }> = {
  COMPLETED: { text: 'Completed', tone: 'neutral' },
  IN_PROGRESS: { text: 'In progress', tone: 'solid' },
  PLANNED: { text: 'Planned', tone: 'neutral' },
};

/**
 * Where it is now, after the Figma frames "My vehicle · In transit": the map
 * while the vehicle is on the road, the legs of the journey, and a line on
 * where the position comes from. The tracker's own details never reach the customer.
 */
export function WhereItIs({ job }: { job: PortalJob }) {
  const arrived = hasArrived(job);
  const tracking = useQuery({
    queryKey: ['portal-tracking', job.id],
    queryFn: () => api<JobTracking>(`/portal/jobs/${job.id}/tracking`),
    refetchInterval: arrived ? false : 30_000,
  });
  const current = tracking.data?.current ?? null;
  // The server says whether the unit is reporting, by its own reporting interval.
  const live = Boolean(current) && tracking.data?.signal?.state === 'LIVE';
  const lastEntry = job.statusHistory.at(-1);
  const destination = countryName(job.destinationCountry);

  const badge = arrived ? <Badge tone="solid">Arrived</Badge> : live ? <Badge tone="solid">Live</Badge> : <Badge>{job.routeLabel}</Badge>;
  const footnote = arrived
    ? 'Your importer will contact you to arrange collection.'
    : live && current
      ? `Live position from the tracker in the vehicle, updated ${relativeTime(current.recordedAt)}. The tracker number is never shown to you.`
      : current
        ? `Last known position, recorded ${formatDateTime(current.recordedAt)}. The vehicle may have moved since.`
        : null;

  return (
    <Card className="portal-card portal-where">
      <div className="portal-card-head">
        <Heading level={2} size="md">
          Where it is now
        </Heading>
        {badge}
      </div>
      {arrived ? (
        <p className="portal-where-panel">{`Arrived in ${destination}${lastEntry ? ` · ${formatDate(lastEntry.createdAt)}` : ''}`}</p>
      ) : current && tracking.data ? (
        <div className="portal-map">
          <JourneyMap
            key={job.id}
            map={tracking.data.map ?? FALLBACK_MAP}
            trail={tracking.data.trail ?? []}
            markers={[
              {
                id: job.id,
                latitude: current.latitude,
                longitude: current.longitude,
                heading: current.heading,
                label: vehicleName(job.vehicle),
                sublabel: job.statusLabel,
              },
            ]}
            plannedRoutes={tracking.data.plannedRoute?.length > 1 ? [tracking.data.plannedRoute] : []}
          />
        </div>
      ) : (
        <p className="portal-where-panel">{tracking.isLoading ? 'Finding your vehicle…' : 'Location will appear once the vehicle is on the road.'}</p>
      )}
      {job.journeys.length ? (
        <ol className="portal-legs" aria-label="The legs of the journey">
          {job.journeys.map((leg, index) => {
            const state = LEG_LABEL[leg.status] ?? LEG_LABEL.PLANNED;
            return (
              <li key={leg.id} data-state={leg.status}>
                <span className="portal-legs-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="portal-legs-name">{`${place(leg.origin)} → ${place(leg.destination)}`}</span>
                <Badge tone={state.tone}>{state.text}</Badge>
              </li>
            );
          })}
        </ol>
      ) : null}
      {footnote ? (
        <Text size="sm" tone="muted" className="portal-where-note">
          {footnote}
        </Text>
      ) : null}
    </Card>
  );
}
