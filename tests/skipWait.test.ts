import { expect, it, vi } from 'vitest';
import { createService } from '../src/application/service';
import { DEFAULT_SETTINGS, DAY, GRACE, MINUTE } from '../src/domain/model';
import { fixture, NOW, tab } from './helpers';

it('skips the current grace period immediately, retaining age, exclusions, and tab protections', async () => {
  const f = await fixture([
    tab(),
    tab({ id: 2, active: true }),
    tab({ id: 3, pinned: true }),
    tab({ id: 4, audible: true }),
    tab({ id: 5, highlighted: true }),
    tab({ id: 6, loading: true }),
    tab({ id: 7, lastAccessed: NOW - DAY }),
    tab({ id: 8, url: 'https://work.example.org/notes' }),
    tab({ id: 9, incognito: true }),
  ]);
  await f.store.saveSettings({
    ...DEFAULT_SETTINGS,
    excludedDomains: ['example.org'],
  });
  // An override must also bypass the missed-heartbeat detection for this check.
  f.advance(3 * MINUTE);
  expect((await f.store.session())!.graceUntil).toBeGreaterThan(
    NOW + 3 * MINUTE,
  );
  await f.service.handle({ type: 'skip-wait' });
  expect(f.tabs.close.mock.calls).toEqual([[1]]);
  expect((await f.store.archives())[0]).toMatchObject({
    url: tab().url,
    outcome: 'closed',
  });
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 1 });
  expect(await f.store.session()).toMatchObject({
    graceUntil: NOW + 3 * MINUTE,
    lastCheckAt: NOW + 3 * MINUTE,
    lastCleanupCount: 1,
  });
});

it('persists the override through worker restarts but grants grace after the next long gap or startup', async () => {
  const f = await fixture();
  await f.service.handle({ type: 'skip-wait' });
  const resumed = createService(f.dependencies);
  await resumed.initialize();
  expect((await f.store.session())!.graceUntil).toBe(NOW);
  f.advance(MINUTE);
  await resumed.cleanup();
  expect((await f.store.session())!.graceUntil).toBe(NOW);
  f.advance(DAY);
  await resumed.cleanup();
  expect((await f.store.session())!.graceUntil).toBe(
    NOW + MINUTE + DAY + GRACE,
  );
  await resumed.handle({ type: 'skip-wait' });
  expect((await f.store.session())!.graceUntil).toBe(NOW + MINUTE + DAY);
  await resumed.initialize(true);
  expect((await f.store.session())!.graceUntil).toBe(
    NOW + MINUTE + DAY + GRACE,
  );
});

it('ignores a stale override while paused without shortening the grace period', async () => {
  const f = await fixture();
  const grace = (await f.store.session())!.graceUntil;
  await f.store.saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
  await f.service.handle({ type: 'skip-wait' });
  expect(f.tabs.close).not.toHaveBeenCalled();
  expect((await f.store.settings()).enabled).toBe(false);
  expect((await f.store.session())!.graceUntil).toBe(grace);
});

it('keeps the batch limit and ignores repeated overrides after grace ends', async () => {
  const f = await fixture(
    Array.from({ length: 30 }, (_, index) => tab({ id: index + 1 })),
  );
  await f.service.handle({ type: 'skip-wait' });
  await f.service.handle({ type: 'skip-wait' });
  expect(f.tabs.close).toHaveBeenCalledTimes(25);
  f.advance(MINUTE);
  await f.service.cleanup();
  expect(f.tabs.close).toHaveBeenCalledTimes(30);
});

it('still saves before closing and stops on a failed archive write when skipping grace', async () => {
  const f = await fixture();
  vi.spyOn(f.store, 'saveArchives').mockRejectedValue(
    new Error('Quota exceeded'),
  );
  await f.service.handle({ type: 'skip-wait' });
  expect(f.tabs.close).not.toHaveBeenCalled();
  expect((await f.store.session())!.error).toContain('Cleanup stopped');
});

it('rechecks the live tab after saving during a manual override', async () => {
  const f = await fixture();
  f.tabs.get.mockResolvedValue(tab({ active: true }));
  await f.service.handle({ type: 'skip-wait' });
  expect(f.tabs.close).not.toHaveBeenCalled();
  expect(await f.store.archives()).toHaveLength(1);
});
