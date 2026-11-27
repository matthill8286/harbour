/** A job's status as the customer sees it. The label comes from the job's route. */
export function StatusBadge({ status, label, inverted = false }: { status: string; label: string; inverted?: boolean }) {
  const tone = status === 'COMPLETED' ? 'bg-harbour text-paper' : status === 'CANCELLED' ? 'bg-ink/10 text-ink/50' : 'bg-harbour/10 text-harbour';
  return (
    <span className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${inverted ? 'bg-paper/15 text-paper' : tone}`}>
      {label}
    </span>
  );
}
