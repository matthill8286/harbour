import { createContext } from 'react';

type Slot = {
  /** The element in the shell's `phone-header` slot that pages render into. */
  element: HTMLElement | null;
  /** Mark the slot as taken by a page; returns the release. */
  claim: () => () => void;
};

/** Where a page's phone header goes. The shell provides it; `PhoneHeader` renders into it. */
export const PhoneHeaderSlot = createContext<Slot>({ element: null, claim: () => () => {} });
