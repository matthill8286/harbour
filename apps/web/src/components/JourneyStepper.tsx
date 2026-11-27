/** Where a job is on its route, as the customer sees it. The steps come from the route's visible stages. */
export type CustomerProgress = { steps: Array<{ id: string; name: string }>; current: number };

export function JourneyStepper({ progress, embedded = false }: { progress: CustomerProgress; embedded?: boolean }) {
  const shell = embedded ? '' : 'rounded-2xl bg-paper p-4';
  return (
    <ol
      className={`grid gap-2 text-center text-xs ${shell}`}
      style={{ gridTemplateColumns: `repeat(${Math.max(progress.steps.length, 1)}, minmax(0, 1fr))` }}
      aria-label="Journey progress"
    >
      {progress.steps.map((step, index) => {
        // `current` is the step the job is on; past the last step, the job is complete.
        const done = index <= progress.current;
        return (
          <li key={step.id} className={done ? 'font-bold text-harbour' : 'text-ink/35'} aria-current={index === progress.current ? 'step' : undefined}>
            {step.name}
            <div className={`mx-auto mt-2 h-1 w-10 rounded-full ${done ? 'bg-harbour' : 'bg-ink/10'}`} />
          </li>
        );
      })}
    </ol>
  );
}
