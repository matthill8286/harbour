import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Heading, Tabs, Text } from '@atomic-ui/ui-react';
import { TERMINAL_LABELS, type TerminalStatus } from '@vip/shared';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { toLocationPoint } from '../lib/tracking';
import { PhoneHeader } from '../components/PhoneHeader';
import { LoadingScreen } from '../components/ui';
import { OverviewTab } from './job/OverviewTab';
import { closedAt } from './job/history';
import { ActivityTab } from './job/ActivityTab';
import { FilesTab } from './job/FilesTab';
import { MoneyTab } from './job/MoneyTab';
import { StatusStrip } from './job/StatusStrip';
import { TrackingTab } from './job/TrackingTab';
import { NotesTab } from './job/NotesTab';
import type { JobDetail } from './job/types';
import './job/JobWorkspace.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'files', label: 'Files' },
  { id: 'money', label: 'Money' },
  { id: 'activity', label: 'Activity' },
  { id: 'notes', label: 'Notes' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * The job workspace, after the Figma section "04 · Job workspace". This frame
 * holds the heading, the closed-job notice and the tabs; each tab is its own
 * component. The tabs are links, so every tab has an address to share.
 */
export function JobDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tabParam = params.get('tab');
  const activeTab: TabId = TABS.some((tab) => tab.id === tabParam) ? (tabParam as TabId) : 'overview';
  const tabHref = (tab: string) => (tab === 'overview' ? `/jobs/${id}` : `/jobs/${id}?tab=${tab}`);

  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: () => api<JobDetail>(`/import-jobs/${id}`),
    enabled: Boolean(id),
  });
  const job = jobQuery.data;

  if (jobQuery.isLoading) return <LoadingScreen label="Loading the job…" />;
  if (jobQuery.isError || !job) {
    const notFound = jobQuery.error instanceof ApiError && jobQuery.error.status === 404;
    return (
      <div className="job-workspace">
        <Alert tone="danger" heading={notFound ? 'This job does not exist' : 'The job could not load'}>
          {notFound ? 'It may have been removed, or the link is wrong.' : 'Check your connection, then try again.'}
          <div className="job-retry">
            {notFound ? null : (
              <Button variant="secondary" busy={jobQuery.isFetching} busyLabel="Trying again" onClick={() => void jobQuery.refetch()}>
                Try again
              </Button>
            )}
            <Button variant="ghost" href="/jobs">
              Back to jobs
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  const vehicle = [job.vehicle.make, job.vehicle.model, job.vehicle.variant].filter(Boolean).join(' ') || 'Vehicle';
  const customer = `${job.customer.firstName} ${job.customer.lastName}`.trim();
  const closed = job.status === 'COMPLETED' || job.status === 'CANCELLED';
  // A closed job's tasks are stopped, so the Overview tab counts none.
  const openTasks = closed ? 0 : job.tasks.filter((task) => task.status !== 'COMPLETED' && task.status !== 'CANCELLED').length;
  const ending = closedAt(job);
  const items = TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    href: tabHref(tab.id),
    ...(tab.id === 'overview' && openTasks > 0 ? { count: openTasks, countLabel: `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'}` } : {}),
  }));

  return (
    <div className="job-workspace">
      <PhoneHeader>
        <Text size="sm">{`${job.reference} · ${customer}`}</Text>
        <Heading level={1} size="3xl">
          {vehicle}
        </Heading>
      </PhoneHeader>

      {closed ? (
        <Alert tone={job.status === 'CANCELLED' ? 'danger' : 'success'} toneLabel="Job closed" heading={TERMINAL_LABELS[job.status as TerminalStatus]}>
          {[
            ending
              ? `${TERMINAL_LABELS[job.status as TerminalStatus]} on ${formatDate(ending.createdAt)}${ending.changedBy?.name ? ` by ${ending.changedBy.name}` : ''}.`
              : null,
            job.status === 'CANCELLED' && ending?.note ? `Reason: ${ending.note}.` : null,
            'The job is closed and nothing can change; the customer portal shows it as ' + (job.status === 'CANCELLED' ? 'cancelled.' : 'delivered.'),
          ]
            .filter(Boolean)
            .join(' ')}
        </Alert>
      ) : null}

      <div className="job-heading">
        <Button icon="arrow-left" label="Back to jobs" variant="secondary" onClick={() => navigate('/jobs')} />
        <div className="job-title">
          <Text size="sm" tone="muted">{`${job.reference} · ${customer}`}</Text>
          <Heading level={1} size="3xl">
            {vehicle}
          </Heading>
        </div>
        <Tabs className="job-tabs" look="pill" label="Job sections" selected={activeTab} items={items} />
      </div>

      {activeTab === 'overview' ? <OverviewTab job={job} onTab={tabHref} /> : null}
      {activeTab !== 'overview' ? <StatusStrip job={job} /> : null}
      {activeTab === 'tracking' ? <TrackingTab job={job} lastKnown={job.locationEvents?.[0] ? toLocationPoint(job.locationEvents[0]) : null} /> : null}
      {activeTab === 'files' ? <FilesTab job={job} /> : null}
      {activeTab === 'money' ? <MoneyTab job={job} /> : null}
      {activeTab === 'activity' ? <ActivityTab job={job} /> : null}
      {activeTab === 'notes' ? <NotesTab job={job} /> : null}
    </div>
  );
}
