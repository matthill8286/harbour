import { useQuery } from '@tanstack/react-query';
import { Alert, Avatar, Badge, Button, Card, EmptyState, Heading, Text } from '@atomic-ui/ui-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import { LoadingScreen } from '../../components/ui';
import { describeActivity, type ActivityItem } from './activityText';
import { useJobStatus } from './useJobStatus';
import type { JobDetail } from './types';
import './ActivityTab.css';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * The Activity tab, after the Figma frames "Job workspace · Activity": everything
 * done on the job, newest first, each entry read as who did what. It is the
 * staff's audit trail and customers never see it.
 */
export function ActivityTab({ job }: { job: JobDetail }) {
  const jobId = job.id;
  const { currency } = useSession();
  // Status changes read with the job's own route's names.
  const { label } = useJobStatus(job);
  const query = useQuery({
    queryKey: ['job', jobId, 'activity'],
    queryFn: () => api<ActivityItem[]>(`/import-jobs/${jobId}/activity`),
  });
  const items = query.data ?? [];

  return (
    <Card className="job-card job-activity">
      <div className="job-card-head">
        <div>
          <Heading level={2} size="md">
            Activity
          </Heading>
          <Text size="sm" tone="muted">
            Audit trail of everything done on this job. Customers never see this.
          </Text>
        </div>
        <Badge>Internal</Badge>
      </div>
      {query.isLoading ? (
        <LoadingScreen label="Loading activity…" />
      ) : query.isError ? (
        <Alert tone="danger" heading="Activity could not load">
          Check your connection, then try again.
          <div className="job-retry">
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState heading="Nothing recorded yet" lead="Status changes, notes, files, trackers and money changes appear here as they happen." />
      ) : (
        <ol className="job-activity-list">
          {items.map((item) => {
            const { verb, detail } = describeActivity(item, currency, label);
            const who = item.actor?.name ?? 'Harbour';
            return (
              <li key={item.id}>
                <time dateTime={item.createdAt} className="job-activity-when">
                  <span>{formatDate(item.createdAt)}</span>
                  <span>{time(item.createdAt)}</span>
                </time>
                <span className="job-activity-who">
                  <Avatar fullName={who} size="sm" />
                  <strong>{who}</strong>
                </span>
                <span className="job-activity-verb">{verb}</span>
                <span className="job-activity-detail">{detail}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
