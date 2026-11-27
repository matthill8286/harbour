import { CUSTOMER_JOURNEY_STEPS, JOB_STAGE_LABELS, getJobStage, type JobStage, type JobStatus } from '@vip/shared';

const STAFF_STEPS: Array<{ key: JobStage; label: string }> = [
  { key: 'uk', label: JOB_STAGE_LABELS.uk },
  { key: 'registration', label: JOB_STAGE_LABELS.registration },
  { key: 'greece', label: JOB_STAGE_LABELS.greece },
  { key: 'shipping', label: JOB_STAGE_LABELS.shipping },
  { key: 'cyprus', label: JOB_STAGE_LABELS.cyprus },
];

function customerActiveKey(stage: JobStage) {
  if (stage === 'shipping' || stage === 'completed') return 'cyprus';
  if (stage === 'cancelled') return null;
  return stage;
}

export function JourneyStepper({ status, variant = 'staff', embedded = false }: { status: JobStatus; variant?: 'staff' | 'customer'; embedded?: boolean }) {
  const stage = getJobStage(status);
  const shell = embedded ? '' : 'rounded-2xl bg-paper p-4';
  if (variant === 'customer') {
    const active = customerActiveKey(stage);
    return (
      <ol className={`grid grid-cols-4 gap-2 text-center text-xs ${shell}`}>
        {CUSTOMER_JOURNEY_STEPS.map((step, index) => {
          const activeIndex = CUSTOMER_JOURNEY_STEPS.findIndex((item) => item.key === active);
          const done = activeIndex >= 0 && index <= activeIndex;
          return (
            <li key={step.key} className={done ? 'font-bold text-harbour' : 'text-ink/35'}>
              <div className="text-lg">{step.emoji}</div>
              {step.label}
              <div className={`mx-auto mt-2 h-1 w-10 rounded-full ${done ? 'bg-harbour' : 'bg-ink/10'}`} />
            </li>
          );
        })}
      </ol>
    );
  }

  const activeIndex = STAFF_STEPS.findIndex((item) => item.key === stage);
  const completed = stage === 'completed';
  return (
    <ol
      className={`grid grid-cols-5 gap-1 text-center text-[10px] text-mist sm:text-[11px] ${embedded ? '' : 'rounded-2xl bg-paper p-3 text-ink'}`}
      aria-label="Journey progress"
    >
      {STAFF_STEPS.map((step, index) => {
        const done = completed || (activeIndex >= 0 && index <= activeIndex);
        const current = !completed && index === activeIndex;
        return (
          <li
            key={step.key}
            className={
              embedded
                ? current
                  ? 'font-bold text-paper'
                  : done
                    ? 'font-semibold text-mist'
                    : 'text-mist/40'
                : current
                  ? 'font-bold text-harbour'
                  : done
                    ? 'font-semibold text-ink'
                    : 'text-ink/35'
            }
          >
            {step.label}
            <div
              className={`mx-auto mt-1.5 h-1 w-full max-w-16 rounded-full ${
                current ? (embedded ? 'bg-harbour' : 'bg-harbour') : done ? (embedded ? 'bg-mist/70' : 'bg-ink/40') : embedded ? 'bg-paper/20' : 'bg-ink/10'
              }`}
            />
          </li>
        );
      })}
    </ol>
  );
}
