import { getJobStage, getStatusLabel, type JobStage, type JobStatus } from '@vip/shared';

const tones: Record<JobStage, string> = {
  uk: 'bg-harbour/10 text-harbour',
  registration: 'bg-ink/10 text-ink',
  greece: 'bg-signal/25 text-[#8a6200]',
  shipping: 'bg-mist text-harbour',
  cyprus: 'bg-harbour/15 text-harbour',
  completed: 'bg-harbour text-paper',
  cancelled: 'bg-ink/10 text-ink/50',
};

export function StatusBadge({
  status,
  inverted = false,
}: {
  status: string;
  inverted?: boolean;
}) {
  const label = getStatusLabel(status as JobStatus);
  const stage = getJobStage(status as JobStatus);
  return (
    <span
      className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${
        inverted ? 'bg-paper/15 text-paper' : tones[stage]
      }`}
    >
      {label}
    </span>
  );
}
