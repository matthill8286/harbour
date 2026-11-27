import type { ReactNode } from 'react';
import { Avatar, Heading, Text } from '@atomic-ui/ui-react';
import harbourMark from '../assets/harbour-mark.svg';
import './AuthFrame.css';

/** Dots along the route from collection (bottom left) to delivery (top right), drawn once. */
const ROUTE = (() => {
  const [x0, y0, cx, cy, x1, y1] = [20, 330, 70, 40, 330, 30];
  const dots: Array<[number, number]> = [];
  for (let i = 1; i < 26; i += 1) {
    const t = i / 26;
    dots.push([(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1]);
  }
  return { start: [x0, y0], end: [x1, y1], dots };
})();

function RouteArt() {
  return (
    <svg className="auth-route" viewBox="0 0 350 350" aria-hidden="true" focusable="false">
      {ROUTE.dots.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" />
      ))}
      <circle cx={ROUTE.start[0]} cy={ROUTE.start[1]} r="15" />
      <circle cx={ROUTE.start[0]} cy={ROUTE.start[1]} r="5" className="auth-route-hole" />
      <circle cx={ROUTE.end[0]} cy={ROUTE.end[1]} r="14" className="auth-route-ring" />
    </svg>
  );
}

/**
 * The sign-in layout, after the Figma page "04 · Auth & access": the form on a
 * light card, and a dark panel with the brand, the route and a line about
 * Harbour. A customer's invite shows their importer instead of Harbour. On a
 * phone the panel goes and the logo sits above the form.
 */
export function AuthFrame({
  children,
  headline = 'Every import, from collection to delivery.',
  lead = 'Jobs, customers, documents and tracking for vehicle import desks.',
  importer,
}: {
  children: ReactNode;
  headline?: string;
  lead?: string;
  /** Shown in place of the Harbour logo, as on a customer's invite. */
  importer?: { name: string; caption: string };
}) {
  const logo = (
    <span className="auth-logo">
      <img src={harbourMark} alt="" width={36} height={36} />
      <span>harbour</span>
    </span>
  );
  return (
    <div className="auth">
      <main className="auth-card">
        <div className="auth-phone-logo">{logo}</div>
        <div className="auth-body">{children}</div>
      </main>
      <aside className="auth-panel" aria-label="About Harbour">
        {importer ? (
          <span className="auth-importer">
            <Avatar fullName={importer.name} size="md" />
            <span>
              <strong>{importer.name}</strong>
              <small>{importer.caption}</small>
            </span>
          </span>
        ) : (
          logo
        )}
        <RouteArt />
        <div className="auth-panel-text">
          <Heading level={2} size="4xl" className="auth-headline">
            {headline}
          </Heading>
          <Text size="sm">{lead}</Text>
        </div>
      </aside>
    </div>
  );
}

/** A screen with a message and its next steps rather than a form: signed out, link not valid. */
export function AuthNotice({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <section className="auth-notice" aria-live="polite">
      <Heading level={1} size="3xl" className="auth-title">
        {title}
      </Heading>
      <Text tone="muted">{lead}</Text>
      {children ? <div className="auth-actions">{children}</div> : null}
    </section>
  );
}
