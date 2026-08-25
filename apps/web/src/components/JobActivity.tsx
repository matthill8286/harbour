import { useQuery } from '@tanstack/react-query';
import { getStatusLabel, type JobStatus } from '@vip/shared';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Card } from './ui';

type ActivityItem = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actor: { name: string } | null;
  metadata: {
    from?: string;
    to?: string;
    customerVisible?: boolean;
    name?: string;
    filename?: string;
    serialNumber?: string;
    visibility?: string;
  } | null;
};

const ACTION_LABELS: Record<string, string> = {
  JOB_CREATED: 'Job created',
  JOB_STATUS_CHANGED: 'Status changed',
  JOB_NOTE_ADDED: 'Note added',
  DOCUMENT_UPLOADED: 'Document uploaded',
  PHOTO_UPLOADED: 'Photo uploaded',
  FILE_VISIBILITY_CHANGED: 'File sharing updated',
  TRACKER_ASSIGNED: 'Tracker assigned',
  TRACKER_UNASSIGNED: 'Tracker removed',
};

function describeActivity(item: ActivityItem) {
  const meta = item.metadata ?? {};
  if (item.action === 'JOB_STATUS_CHANGED' && meta.from && meta.to) {
    return `${getStatusLabel(meta.from as JobStatus)} → ${getStatusLabel(meta.to as JobStatus)}`;
  }
  if (item.action === 'JOB_NOTE_ADDED') {
    return meta.visibility === 'CUSTOMER' ? 'Visible to customer' : 'Internal only';
  }
  if (item.action === 'FILE_VISIBILITY_CHANGED') {
    return meta.customerVisible ? `${meta.name ?? 'File'} shared with customer` : `${meta.name ?? 'File'} kept internal`;
  }
  if (item.action === 'DOCUMENT_UPLOADED' || item.action === 'PHOTO_UPLOADED') {
    return meta.name ?? meta.filename ?? 'File attached';
  }
  if (item.action === 'TRACKER_ASSIGNED') {
    return meta.serialNumber ?? 'Tracker attached to this job';
  }
  return ACTION_LABELS[item.action] ?? item.action;
}

export function JobActivity({ jobId }: { jobId: string }) {
  const query = useQuery({
    queryKey: ['job', jobId, 'activity'],
    queryFn: () => api<ActivityItem[]>(`/import-jobs/${jobId}/activity`),
  });
  const items = query.data ?? [];

  return (
    <Card>
      <h2 className="font-semibold">Activity</h2>
      <p className="text-xs text-ink/45">Staff-only audit trail. Customers never see this.</p>
      {query.isLoading ? <p className="mt-3 text-sm text-ink/50">Loading activity…</p> : null}
      {items.length === 0 && !query.isLoading ? (
        <p className="mt-3 text-sm text-ink/50">No recorded activity yet.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-xl bg-sand/70 px-3 py-2 text-sm">
              <div>
                <p className="font-semibold">{ACTION_LABELS[item.action] ?? item.action}</p>
                <p className="text-xs text-ink/55">
                  {describeActivity(item)}
                  {item.actor?.name ? ` · ${item.actor.name}` : ''}
                </p>
              </div>
              <time className="text-xs text-ink/45">{formatDateTime(item.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
