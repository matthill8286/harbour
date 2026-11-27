import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Heading, Text } from '@atomic-ui/ui-react';
import { api, ApiError, downloadApiFile } from '../lib/api';
import { formatCategory, formatDate } from '../lib/format';
import { useSession } from '../lib/session';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import { countryName } from './job/countries';
import { JourneySteps } from './portal/JourneySteps';
import { PhotoViewer } from './portal/PhotoViewer';
import { WhereItIs } from './portal/WhereItIs';
import { hasArrived, headline, legLine, vehicleName, type PortalJob } from './portal/portal';
import './portal/Portal.css';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How many photos show on the card before "View all". */
const PHOTOS_SHOWN = 2;

function Heading1({ title, onBack }: { title: string; onBack: () => void }) {
  const { workspace } = useSession();
  return (
    <div className="portal-heading has-back">
      <Button variant="secondary" icon="arrow-left" label="Back to your vehicles" onClick={onBack} />
      <div>
        <Text size="sm" tone="muted">{`${workspace} · Customer portal`}</Text>
        <Heading level={1} size="4xl">
          {title}
        </Heading>
      </div>
    </div>
  );
}

/**
 * One vehicle, after the Figma frames "Customer · My vehicle": where it is, the
 * journey, updates from the importer, and the photos and documents shared.
 */
export function PortalJobPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { workspace } = useSession();
  const [viewing, setViewing] = useState<number | null>(null);
  const query = useQuery({ queryKey: ['portal-job', id], queryFn: () => api<PortalJob>(`/portal/jobs/${id}`), enabled: Boolean(id) });
  const back = () => navigate('/portal');

  if (query.isLoading) return <LoadingScreen label="Loading your vehicle…" />;
  const job = query.data;
  if (query.isError || !job) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="portal">
        <Heading1 title="Your vehicle" onBack={back} />
        <Card className="portal-card portal-state">
          <Heading level={2} size="xl">
            {missing ? 'This vehicle is not in your portal' : 'Could not load this vehicle'}
          </Heading>
          <Text tone="muted">{missing ? 'The link may be old, or the import was opened under another account.' : 'Check your connection and try again.'}</Text>
          <div className="portal-state-actions">
            <Button variant="secondary" onClick={back}>
              Your vehicles
            </Button>
            {missing ? null : (
              <Button busy={query.isFetching} busyLabel="Trying again" onClick={() => void query.refetch()}>
                Retry
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const name = vehicleName(job.vehicle);
  const arrived = hasArrived(job);
  const destination = countryName(job.destinationCountry);
  const sub =
    job.status === 'COMPLETED'
      ? 'Your vehicle has been handed over.'
      : arrived
        ? 'Every leg is complete.'
        : (legLine(job.journeys) ?? job.journey.find((s) => s.state === 'current')?.detail ?? '');
  const lastEntry = job.statusHistory.at(-1);
  const when = arrived
    ? { label: `Arrived in ${destination}`, value: lastEntry ? formatDate(lastEntry.createdAt) : null }
    : { label: `Expected in ${destination}`, value: job.expectedDeliveryDate ? formatDate(job.expectedDeliveryDate) : 'Date to follow' };
  const updates = [...job.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cover = job.photos[0];
  const extra = job.photos.length - PHOTOS_SHOWN;

  return (
    <div className="portal">
      <PhoneHeader>
        <Text size="sm">{job.reference}</Text>
        <Heading level={1} size="3xl">
          {`Your ${name}`}
        </Heading>
      </PhoneHeader>
      <Heading1 title={`Your ${name}`} onBack={back} />

      <div className="portal-job-grid">
        <section className={`portal-hero${cover ? ' has-photo' : ''}`} aria-label={`${name}: ${headline(job)}`}>
          {cover ? <AuthenticatedImage path={`/portal/jobs/${job.id}/photos/${cover.id}`} alt="" className="portal-hero-photo" /> : null}
          <div className="portal-hero-top">
            <div className="portal-hero-badges">
              <Badge tone={job.started ? 'solid' : 'neutral'}>{job.statusLabel}</Badge>
              {job.vehicle.ukRegistration ? <Badge tone="neutral">{job.vehicle.ukRegistration}</Badge> : null}
              <Badge tone="neutral" className="portal-hero-ref">
                {job.reference}
              </Badge>
            </div>
            <Heading level={2} size="3xl" className="portal-hero-title">
              {headline(job)}
            </Heading>
            {sub ? <Text size="sm">{sub}</Text> : null}
            {job.status !== 'CANCELLED' ? (
              <p className="portal-hero-when">
                <small>{when.label}</small>
                <strong>{when.value}</strong>
              </p>
            ) : null}
          </div>
          <div className="portal-hero-steps">
            <JourneySteps steps={job.journey} marks />
          </div>
        </section>

        <WhereItIs job={job} />

        <Card className="portal-card">
          <div className="portal-card-head">
            <Heading level={2} size="md">{`Updates from ${workspace}`}</Heading>
            <Text size="sm" tone="muted">
              {plural(updates.length, 'update', 'updates')}
            </Text>
          </div>
          {updates.length ? (
            <ol className="portal-updates">
              {updates.map((note, index) => (
                <li key={note.id}>
                  <span className={`portal-updates-date${index === 0 ? ' is-latest' : ''}`}>{day(note.createdAt)}</span>
                  <span className={index === 0 ? 'is-latest' : undefined}>{note.body}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Text size="sm" tone="muted">
              No updates yet.
            </Text>
          )}
        </Card>

        <Card className="portal-card">
          <div className="portal-card-head">
            <Heading level={2} size="md">
              Photos
            </Heading>
            {job.photos.length > PHOTOS_SHOWN ? (
              <Button variant="ghost" size="sm" onClick={() => setViewing(0)}>
                {`See all ${job.photos.length}`}
              </Button>
            ) : (
              <Text size="sm" tone="muted">{`${job.photos.length} shared`}</Text>
            )}
          </div>
          {job.photos.length ? (
            <ul className="portal-photos">
              {job.photos.slice(0, PHOTOS_SHOWN).map((photo, index) => (
                <li key={photo.id}>
                  <button type="button" onClick={() => setViewing(index)} aria-label={`Open photo ${index + 1}, ${formatCategory(photo.category)}`}>
                    <AuthenticatedImage path={`/portal/jobs/${job.id}/photos/${photo.id}`} alt="" className="portal-photo" />
                    <span className="portal-photo-tag">{formatCategory(photo.category)}</span>
                  </button>
                </li>
              ))}
              {extra > 0 ? (
                <li>
                  <button type="button" className="portal-photos-more" onClick={() => setViewing(PHOTOS_SHOWN)}>
                    <strong>{`+${extra}`}</strong>
                    <span>View all</span>
                  </button>
                </li>
              ) : null}
            </ul>
          ) : (
            <Text size="sm" tone="muted">
              No photos have been shared yet. They will appear here when your importer releases them.
            </Text>
          )}
        </Card>

        <Card className="portal-card">
          <div className="portal-card-head">
            <Heading level={2} size="md">
              Documents
            </Heading>
            <Text size="sm" tone="muted">{`${job.documents.length} shared`}</Text>
          </div>
          {job.documents.length ? (
            <ul className="portal-docs">
              {job.documents.map((doc) => (
                <li key={doc.id}>
                  <span className="portal-docs-kind" aria-hidden="true">
                    {doc.mimeType === 'application/pdf' ? 'PDF' : (doc.name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase()}
                  </span>
                  <span className="portal-docs-name">
                    <strong>{doc.name}</strong>
                    <small>{`${formatCategory(doc.type)} · ${formatDate(doc.createdAt)}`}</small>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="download"
                    label={`Download ${doc.name}`}
                    onClick={() => void downloadApiFile(`/portal/jobs/${job.id}/documents/${doc.id}`, doc.name)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Text size="sm" tone="muted">
              No documents have been shared yet.
            </Text>
          )}
        </Card>
      </div>

      {viewing !== null ? <PhotoViewer jobId={job.id} photos={job.photos} start={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
