/** Older helpers still used by the QR scanner's dialog, and the loading line used across the app. */

export const secondaryBtn =
  'inline-flex items-center justify-center rounded-xl border border-ink/15 bg-paper px-4 py-2 text-sm font-semibold transition hover:bg-sand disabled:opacity-50';

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
