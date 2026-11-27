import type { MouseEvent } from 'react';

/**
 * Open the row a click landed on, for an impakt-table whose first cell holds the
 * row's link. The whole row can be pressed, as the designs ask, while the link
 * stays the one thing a keyboard reaches. A click on the link itself, or on
 * anything else that is a link, is left to the link.
 */
export function openRowLink(event: MouseEvent<HTMLElement>, navigate: (href: string) => void) {
  const path = event.nativeEvent.composedPath();
  if (path.some((node) => node instanceof HTMLAnchorElement)) return;
  const row = path.find((node): node is HTMLTableRowElement => node instanceof HTMLTableRowElement);
  const slot = row?.querySelector('slot');
  const first = slot?.assignedElements()[0];
  const link = first instanceof HTMLAnchorElement ? first : first?.querySelector('a');
  const href = link?.getAttribute('href');
  if (href) navigate(href);
}
