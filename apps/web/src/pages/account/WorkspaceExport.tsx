import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Heading, Text } from '@atomic-ui/ui-react';
import { downloadApiFile } from '../../lib/api';
import { formatDate } from '../../lib/format';

export type WorkspaceClosure = { contractEndsAt: string; deleteAfter: string } | null;

/**
 * The whole workspace as one download, GPS positions included. It works while
 * the plan has lapsed, and it is how a business takes its data when it leaves.
 */
export function WorkspaceExport({ slug, closure }: { slug: string; closure: WorkspaceClosure }) {
  const download = useMutation({
    mutationFn: () => downloadApiFile('/organisation/export', `harbour-${slug}.zip`),
  });
  return (
    <Card className="account-card">
      <Heading level={2} size="md">
        Export all workspace data
      </Heading>
      {closure ? (
        <Alert tone="warning" heading="This workspace is due to be deleted">
          The contract ended on {formatDate(closure.contractEndsAt)}. All of the workspace’s data and files will be deleted after{' '}
          {formatDate(closure.deleteAfter)}. Download it before then.
        </Alert>
      ) : null}
      <Text size="sm" tone="muted">
        One ZIP file with every record in this workspace, including customers, jobs, trackers and GPS positions, and every document and photo as it was
        uploaded. Passwords and secrets are left out. This works even when the plan has ended.
      </Text>
      {download.isError ? (
        <Alert tone="danger" heading="The export did not download">
          {download.error.message}
        </Alert>
      ) : null}
      <div className="account-actions">
        <Button variant="secondary" iconBefore="download" busy={download.isPending} busyLabel="Preparing the export" onClick={() => download.mutate()}>
          Download workspace data
        </Button>
      </div>
    </Card>
  );
}
