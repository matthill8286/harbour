import type { ReactNode } from 'react';

export const fieldClass =
  'w-full rounded-xl border border-ink/10 bg-paper px-3 py-2 text-sm outline-none transition focus:border-harbour disabled:bg-sand disabled:text-ink/55';

export const primaryBtn =
  'inline-flex items-center justify-center rounded-xl bg-harbour px-4 py-2 text-sm font-semibold text-paper transition hover:bg-harbour/90 disabled:opacity-50';

export const secondaryBtn =
  'inline-flex items-center justify-center rounded-xl border border-ink/15 bg-paper px-4 py-2 text-sm font-semibold transition hover:bg-sand disabled:opacity-50';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="text-xs uppercase tracking-[0.2em] text-harbour">{eyebrow}</p> : null}
        <h1 className="display text-4xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink/60">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** Constrained reading column for list/form pages inside the stable shell. */
export function StaffPage({ children, wide = false, className = '' }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={`staff-page ${wide ? 'is-wide' : ''} ${className}`.trim()}>{children}</div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-paper p-4 ${className}`}>{children}</section>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Card className="py-10 text-center">
      <p className="font-semibold">{title}</p>
      {description ? <p className="mt-1 text-sm text-ink/55">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>;
}

export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-ink/55">
      <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-harbour" />
      {label}
    </div>
  );
}
