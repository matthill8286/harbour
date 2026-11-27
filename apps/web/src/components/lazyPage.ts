import { lazy, type ComponentType } from 'react';
import { loadPage } from '../lib/chunk-load';

/** A page whose code is fetched the first time someone opens it. */
export function lazyPage<Name extends string>(load: () => Promise<Record<Name, ComponentType>>, name: Name) {
  return lazy(async () => ({ default: (await loadPage(load))[name] }));
}
