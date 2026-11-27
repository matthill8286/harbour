import { useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PhoneHeaderSlot } from '../lib/phone-header';

/**
 * A page's header on a phone, shown on the dark band above the content. The
 * shell turns the text colour tokens light there, so design-system text reads
 * light without being told. On a desktop it is not shown; the page's own
 * heading is. While no page renders one, the shell shows the workspace.
 */
export function PhoneHeader({ children }: { children: ReactNode }) {
  const { element, claim } = useContext(PhoneHeaderSlot);
  useEffect(() => claim(), [claim]);
  return element ? createPortal(children, element) : null;
}
