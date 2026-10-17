import { expect, it, vi } from 'vitest';
import { createService } from '../src/application/service';
import { DEFAULT_SETTINGS, type ArchivedLink } from '../src/domain/model';
import { createStore, migrate } from '../src/platform/storage';
import { fixture, MemoryArea, NOW, tab } from './helpers';

function entry(overrides: Partial<ArchivedLink> = {}): ArchivedLink {
  return {
    id: crypto.randomUUID(),
    url: 'https://example.com',
    title: 'Archived page',
    lastUsedAt: NOW,
    archivedAt: NOW,
    outcome: 'closed',
    operationKey: crypto.randomUUID(),
    ...overrides,
  };
}

it('starts at zero and counts automatic closures across worker and browser restarts', async () => {
  const f = await fixture([tab({ id: 1 }), tab({ id: 2 })]);
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 0 });
  await f.endGrace();
  await f.service.cleanup();
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 2 });
  const restarted = createService(f.dependencies);
  await restarted.initialize(true);
  await restarted.cleanup();
  expect(
    await restarted.handle({
      type: 'view',
      query: 'no results',
      page: 1,
      pageSize: 6,
    }),
  ).toMatchObject({
    matching: 0,
    statistics: { lifetimeArchivedTabs: 2 },
  });
});

it('keeps lifetime totals after reopening, deletion, and re-importing a deleted link', async () => {
  const f = await fixture();
  await f.endGrace();
  await f.service.cleanup();
  const backup = await f.service.handle({ type: 'export' });
  const id = backup.entries[0]!.id;
  await f.service.handle({ type: 'reopen', id });
  await f.service.handle({ type: 'delete', id });
  await f.store.initialize();
  expect(await f.store.archives()).toHaveLength(0);
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 1 });
  await f.service.handle({ type: 'import', backup });
  await f.service.handle({ type: 'import', backup });
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 1 });
  const target = await fixture([]);
  await target.service.handle({ type: 'import', backup });
  await target.store.initialize();
  expect(await target.store.statistics()).toEqual({ lifetimeArchivedTabs: 0 });
});

it('does not count a failed close, and counts its successful retry just once', async () => {
  const f = await fixture();
  await f.endGrace();
  f.tabs.close.mockRejectedValueOnce(new Error('Tab is being dragged'));
  await f.service.cleanup();
  expect(await f.store.archives()).toHaveLength(1);
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 0 });
  await f.service.cleanup();
  const saved = (await f.store.archives())[0]!;
  await f.store.recordClosure(saved.id);
  await f.service.cleanup();
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 1 });
});

it('does not count a saved tab that becomes protected before closing', async () => {
  const f = await fixture();
  await f.endGrace();
  f.tabs.get.mockResolvedValue(tab({ pinned: true }));
  await f.service.cleanup();
  expect(await f.store.archives()).toHaveLength(1);
  expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 0 });
});

it('migrates existing confirmed automatic closures once, preserving links and settings', async () => {
  const local = new MemoryArea();
  const closed = entry();
  const pending = entry({ outcome: 'saved' });
  const imported = entry({ operationKey: undefined });
  local.values = {
    meta: { version: 1 },
    settings: { ...DEFAULT_SETTINGS, inactivityDays: 23 },
    ...Object.fromEntries(
      [closed, pending, imported].map((item) => [`archive:${item.id}`, item]),
    ),
  };
  const before = structuredClone(local.values);
  const store = createStore(local, new MemoryArea());
  await store.initialize();
  expect(local.values.meta).toEqual({ version: 2 });
  expect(await store.statistics()).toEqual({ lifetimeArchivedTabs: 1 });
  expect(await store.archives()).toEqual([closed, pending, imported]);
  expect(local.values.settings).toEqual(before.settings);
  await store.deleteArchive(closed.id);
  await store.initialize();
  expect(await store.statistics()).toEqual({ lifetimeArchivedTabs: 1 });
});

it('does not modify a legacy installation if an archive cannot be migrated', async () => {
  const local = new MemoryArea();
  local.values = {
    meta: { version: 1 },
    settings: DEFAULT_SETTINGS,
    'archive:invalid': { title: 'keep' },
  };
  const before = structuredClone(local.values);
  await expect(migrate(local)).rejects.toThrow();
  expect(local.values).toEqual(before);
});

it.each([
  undefined,
  { lifetimeArchivedTabs: -1 },
  { lifetimeArchivedTabs: 1.5 },
])(
  'refuses to silently reset invalid statistics in version 2: %j',
  async (statistics) => {
    const local = new MemoryArea();
    local.values = {
      meta: { version: 2 },
      settings: DEFAULT_SETTINGS,
      statistics,
    };
    const before = structuredClone(local.values);
    await expect(migrate(local)).rejects.toThrow();
    expect(local.values).toEqual(before);
  },
);

it('writes the completion and count together and can retry a rejected write', async () => {
  const local = new MemoryArea();
  const store = createStore(local, new MemoryArea());
  await store.initialize();
  const pending = entry({ outcome: 'saved' });
  await store.saveArchives([pending]);
  const write = vi
    .spyOn(local, 'set')
    .mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(store.recordClosure(pending.id)).rejects.toThrow();
  expect(await store.statistics()).toEqual({ lifetimeArchivedTabs: 0 });
  expect((await store.archives())[0]?.outcome).toBe('saved');
  await store.recordClosure(pending.id);
  expect(write).toHaveBeenLastCalledWith({
    [`archive:${pending.id}`]: { ...pending, outcome: 'closed' },
    statistics: { lifetimeArchivedTabs: 1 },
  });
  await store.recordClosure(pending.id);
  expect(await store.statistics()).toEqual({ lifetimeArchivedTabs: 1 });
});
