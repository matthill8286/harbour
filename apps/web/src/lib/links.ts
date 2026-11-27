import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The anchor a click landed on, looking through shadow roots. The design
 * system's rows, stat tiles, tabs and link buttons draw their `<a>` inside
 * their own shadow root, so `event.target` is the custom element, not the link.
 */
export function anchorOf(event: MouseEvent): HTMLAnchorElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement) return node;
  }
  return null;
}

/** Whether a click on a link should be routed in the app rather than left to the browser. */
export function isAppNavigation(event: MouseEvent, anchor: HTMLAnchorElement, origin: string): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  return new URL(anchor.href, origin).origin === origin;
}

/**
 * Route same-origin links in the app, so following one never reloads the
 * page. React Router's `<Link>` already does this; this covers the links the
 * design system's elements draw. A link whose click was already handled, such
 * as a side navigation item whose `impakt-navigate` the shell cancelled, is
 * left alone, as is any click meant for a new tab.
 */
export function useAppLinks(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = anchorOf(event);
      if (!anchor || !isAppNavigation(event, anchor, window.location.origin)) return;
      event.preventDefault();
      const url = new URL(anchor.href);
      navigate(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);
}
