import { Alert, Badge, Button, Progress, Text } from '@atomic-ui/ui-react';
import { JOB_STAGE_LABELS, JOB_STAGES, getJobStage, getStatusLabel, type JobStage } from '@vip/shared';
import { formatDate } from '../../lib/format';
import { countryName } from './countries';
import { useJobStatus } from './useJobStatus';
import type { JobDetail } from './types';

const JOURNEY: JobStage[] = JOB_STAGES.filter((stage) => stage !== 'completed' && stage !== 'cancelled');
const STEPS = JOURNEY.map((stage) => ({ id: stage, label: JOB_STAGE_LABELS[stage] }));

/**
 * The job's status in one line, at the top of every tab but Overview, after the
 * Figma frame "Job workspace · Tracking": the status, the plate, the corridor
 * and the delivery date, the journey bars, and the step forward.
 */
export function StatusStrip({ job }: { job: JobDetail }) {
  const { editable, next, move } = useJobStatus(job);
  const stage = getJobStage(job.status);
  const facts = [
    job.vehicle.ukRegistration,
    `${countryName(job.originCountry)} → ${countryName(job.destinationCountry)}`,
    job.expectedDeliveryDate ? `Expected ${formatDate(job.expectedDeliveryDate)}` : null,
  ].filter(Boolean);

  return (
    <section className="job-strip" aria-label="Job status">
      <Badge tone="inverse">{getStatusLabel(job.status)}</Badge>
      <Text size="sm" tone="muted" className="job-strip-facts">
        {facts.join(' · ')}
      </Text>
      <Progress look="bars" label="Journey" steps={STEPS} current={stage === 'completed' ? 'cyprus' : stage} className="job-strip-bars" />
      {editable && next ? (
        <Button iconAfter="arrow-right" busy={move.isPending} busyLabel="Moving the job" onClick={() => move.mutate(next)}>
          {`Move to ${getStatusLabel(next)}`}
        </Button>
      ) : null}
      {move.isError ? (
        <Alert tone="danger" heading="The job did not move" className="job-strip-error">
          {move.error instanceof Error ? move.error.message : 'Try again.'}
        </Alert>
      ) : null}
    </section>
  );
}
