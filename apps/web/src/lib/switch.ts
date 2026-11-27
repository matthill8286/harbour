import type { MouseEvent } from 'react';

/**
 * impakt-switch toggles a native checkbox inside its shadow root, and that
 * change event does not reach React. This reads the switch once the click has
 * toggled it, and calls back only when it really changed.
 */
export function onSwitch(current: boolean, handler: (checked: boolean) => void) {
  return (event: MouseEvent<HTMLElement>) => {
    const element = event.currentTarget as HTMLElement & { checked: boolean };
    window.setTimeout(() => {
      if (element.checked !== current) handler(element.checked);
    });
  };
}
