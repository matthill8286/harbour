import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, EmptyState, Heading, Icon, Row, Text } from '@atomic-ui/ui-react';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import { countryName } from './job/countries';
import { JourneySteps } from './portal/JourneySteps';
import { hasArrived, headline, isOpen, vehicleName, type PortalVehicle } from './portal/portal';
import './portal/Portal.css';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function VehicleCard({ job }: { job: PortalVehicle }) {
  const name = vehicleName(job.vehicle);
  const when =
    job.expectedDeliveryDate && !hasArrived(job) ? `expected in ${countryName(job.destinationCountry)} ${formatDate(job.expectedDeliveryDate)}` : null;
  return (
    <Card className="portal-card portal-vehicle" padding="none">
      <a className="portal-vehicle-photo" href={`/portal/${job.id}`} tabIndex={-1} aria-hidden="true">
        {job.coverPhotoId ? (
          <AuthenticatedImage path={`/portal/jobs/${job.id}/photos/${job.coverPhotoId}`} alt="" className="portal-cover" />
        ) : (
          <span className="portal-no-photo">No photos shared yet</span>
        )}
        <span className="portal-vehicle-phone-badge">{headline(job)}</span>
      </a>
      <div className="portal-vehicle-body">
        <div className="portal-vehicle-head">
          <div>
            <Badge tone={job.started ? 'solid' : 'neutral'} className="portal-vehicle-badge">
              {job.statusLabel}
            </Badge>
            <Heading level={2} size="2xl">
              <a href={`/portal/${job.id}`} className="portal-vehicle-link">
                {name}
              </a>
            </Heading>
            <Text size="sm" tone="muted">
              {[job.vehicle.ukRegistration, when].filter(Boolean).join(' · ')}
            </Text>
            <Text size="sm" tone="muted" className="portal-vehicle-shared">
              {`${plural(job.photoCount, 'photo', 'photos')} · ${plural(job.documentCount, 'document', 'documents')}`}
            </Text>
          </div>
          <Button iconAfter="arrow-right" href={`/portal/${job.id}`} className="portal-open">
            Open
          </Button>
          <Button icon="arrow-right" label={`Open ${name}`} href={`/portal/${job.id}`} className="portal-open-phone" />
        </div>
        <JourneySteps steps={job.journey} label={`${name} journey`} />
      </div>
    </Card>
  );
}

/**
 * Your vehicles, after the Figma frames "Customer · Your vehicles": each import
 * the importer opened for this customer, where it is, and what has been shared.
 */
export function PortalPage() {
  const { user, workspace } = useSession();
  const query = useQuery({ queryKey: ['portal-jobs'], queryFn: () => api<PortalVehicle[]>('/portal/jobs') });
  const jobs = query.data ?? [];
  const open = jobs.filter((job) => isOpen(job.status));
  const earlier = jobs.filter((job) => !isOpen(job.status));
  const first = user?.name.split(' ')[0];
  const onTheWay =
    open.length === 0 ? 'Nothing is on its way right now.' : open.length === 1 ? 'One car is on its way.' : `${open.length} cars are on their way.`;
  const greeting = `Hello ${first ?? 'there'}. ${onTheWay}`;

  return (
    <div className="portal">
      <PhoneHeader>
        <Text size="sm">{`${workspace} · Customer portal`}</Text>
        <Heading level={1} size="3xl">
          Your vehicles
        </Heading>
        <Text size="sm">{query.data ? greeting : ' '}</Text>
      </PhoneHeader>

      <div className="portal-heading">
        <Text size="sm" tone="muted">{`${workspace} · Customer portal`}</Text>
        <Heading level={1} size="4xl">
          Your vehicles
        </Heading>
        <Text tone="muted">{`Follow the import ${workspace} opened for you. Photos and documents appear when they are shared.`}</Text>
      </div>

      {query.isLoading ? (
        <LoadingScreen label="Loading your vehicles…" />
      ) : query.isError ? (
        <Card className="portal-card portal-state">
          <Heading level={2} size="xl">
            Could not load your vehicles
          </Heading>
          <Text tone="muted">Check your connection and try again.</Text>
          <Button busy={query.isFetching} busyLabel="Trying again" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Card>
      ) : jobs.length === 0 ? (
        <Card className="portal-card portal-state">
          <EmptyState heading="No import in progress" lead="When a job is opened for you, it will appear here." />
        </Card>
      ) : (
        <>
          {open.map((job) => (
            <VehicleCard key={job.id} job={job} />
          ))}
          {earlier.length ? (
            <Card className="portal-card">
              <Heading level={2} size="md">
                Earlier imports
              </Heading>
              <div role="list">
                {earlier.map((job, index) => (
                  <Row
                    key={job.id}
                    role="listitem"
                    divided={index > 0}
                    heading={vehicleName(job.vehicle)}
                    meta={job.status === 'CANCELLED' ? 'Cancelled' : job.completedAt ? `Collected ${formatDate(job.completedAt)}` : 'Completed'}
                    href={`/portal/${job.id}`}
                  >
                    <Icon slot="start" name={job.status === 'CANCELLED' ? 'close' : 'check'} />
                  </Row>
                ))}
              </div>
            </Card>
          ) : null}
          {open.length === 0 && earlier.length > 0 ? (
            <Alert tone="info" heading="Nothing on its way right now">
              Your importer will add new vehicles here.
            </Alert>
          ) : null}
        </>
      )}
    </div>
  );
}
