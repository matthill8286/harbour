import type { ReactNode } from 'react';

/** The two-column sign-in frame shared by the login, two-factor and setup screens. */
export function AuthFrame({
  eyebrow,
  lead,
  children,
}: {
  eyebrow: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-ink text-paper">
      <div className="mx-auto grid min-h-svh max-w-5xl md:grid-cols-2">
        <section className="hidden flex-col justify-between p-10 md:flex">
          <p className="text-xs uppercase tracking-[0.28em] text-mist">{eyebrow}</p>
          <div>
            <h1 className="display text-5xl leading-tight">Harbour</h1>
            <p className="mt-4 max-w-sm text-mist">{lead}</p>
          </div>
          <p className="text-sm text-mist">Sign in to your organisation workspace.</p>
        </section>
        <section className="flex items-center bg-sand p-6 text-ink md:p-12">
          <div className="w-full max-w-md space-y-4">
            <p className="display text-lg md:hidden">Harbour</p>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
