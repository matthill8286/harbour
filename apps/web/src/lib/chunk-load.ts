/*
 * A release replaces the files under /assets. A tab opened before it still asks for the
 * old names, so loading a page, the map or the scanner can fail. A page load reloads the
 * tab once, which fetches the new index.html and its files.
 */

const RELOADED_AT = 'harbour.chunk-reload';
/** A second failure this soon after a reload is not a stale tab, so it is shown instead. */
const RELOAD_GAP_MS = 60_000;

export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super('A part of the app did not load.', { cause });
    this.name = 'ChunkLoadError';
  }
}

type Tab = {
  online: () => boolean;
  now: () => number;
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  reload: () => void;
};

const browserTab: Tab = {
  online: () => navigator.onLine,
  now: () => Date.now(),
  storage: () => window.sessionStorage,
  reload: () => window.location.reload(),
};

/** Reloads the tab unless it is offline or has just done so. Says whether it did. */
export function reloadOnce(tab: Tab = browserTab): boolean {
  // Offline, a reload would swap the app for the browser's own error page.
  if (!tab.online()) return false;
  try {
    const storage = tab.storage();
    const last = Number(storage.getItem(RELOADED_AT) ?? 0);
    if (tab.now() - last < RELOAD_GAP_MS) return false;
    storage.setItem(RELOADED_AT, String(tab.now()));
  } catch {
    // Without storage there is no way to stop a reload loop.
    return false;
  }
  tab.reload();
  return true;
}

/**
 * Loads a page's code. Use it only where a reload loses nothing, as when someone has
 * just moved to a new page. The address already names that page, so the reload opens it.
 */
export async function loadPage<T>(load: () => Promise<T>, tab: Tab = browserTab): Promise<T> {
  try {
    return await load();
  } catch (error) {
    // The tab is going away, so keep the loading state up instead of flashing an error.
    if (reloadOnce(tab)) return new Promise<T>(() => {});
    throw new ChunkLoadError(error);
  }
}
