import { describe, expect, it, vi } from 'vitest';
import { ChunkLoadError, loadPage, reloadOnce } from './chunk-load';

function tab({ online = true, now = 1_000_000, blocked = false } = {}) {
  const items = new Map<string, string>();
  const clock = { now };
  return {
    clock,
    reload: vi.fn(),
    online: () => online,
    now: () => clock.now,
    storage: () => {
      if (blocked) throw new Error('blocked');
      return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
    },
  };
}

const missing = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

describe('loading a page after a release', () => {
  it('returns the module when it loads', async () => {
    const open = tab();
    await expect(loadPage(() => Promise.resolve('page'), open)).resolves.toBe('page');
    expect(open.reload).not.toHaveBeenCalled();
  });

  it('reloads the tab when the file has gone, and keeps waiting', async () => {
    const stale = tab();
    const settled = vi.fn();
    void loadPage(missing, stale).then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stale.reload).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });

  it('does not reload twice in a row, so a broken release cannot loop', async () => {
    const broken = tab();
    expect(reloadOnce(broken)).toBe(true);
    broken.clock.now += 5_000;
    await expect(loadPage(missing, broken)).rejects.toBeInstanceOf(ChunkLoadError);
    expect(broken.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again for a later release', () => {
    const longOpen = tab();
    reloadOnce(longOpen);
    longOpen.clock.now += 3_600_000;
    expect(reloadOnce(longOpen)).toBe(true);
  });

  it.each([
    ['offline', { online: false }],
    ['without storage', { blocked: true }],
  ])('shows the error instead of reloading %s', async (_name, options) => {
    const stuck = tab(options);
    await expect(loadPage(missing, stuck)).rejects.toBeInstanceOf(ChunkLoadError);
    expect(stuck.reload).not.toHaveBeenCalled();
  });
});
