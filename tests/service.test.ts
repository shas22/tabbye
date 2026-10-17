import { describe, expect, it, vi } from 'vitest';
import { createService } from '../src/application/service';
import {
  MINUTE,
  DAY,
  DEFAULT_SETTINGS,
  backupSchema,
} from '../src/domain/model';
import { fixture, NOW, tab } from './helpers';

describe('cleanup lifecycle', () => {
  it('does not read the archive when there are no eligible tabs', async () => {
    const f = await fixture([tab({ lastAccessed: NOW - DAY })]);
    await f.endGrace();
    const read = vi.spyOn(f.store, 'archives');
    await f.service.cleanup();
    expect(read).not.toHaveBeenCalled();
    expect(f.tabs.close).not.toHaveBeenCalled();
    expect((await f.store.session())!.lastCleanupAt).toBe(NOW);
  });
  it('preserves fractional browser timestamps during initialization and archiving', async () => {
    const lastAccessed = NOW - 10 * DAY + 0.375;
    const f = await fixture([tab({ lastAccessed })]);
    expect((await f.store.session())?.observations['1']?.lastUsedAt).toBe(
      lastAccessed,
    );
    await f.endGrace();
    await f.service.cleanup();
    expect(f.tabs.close).toHaveBeenCalledWith(1);
    expect((await f.store.archives())[0]?.lastUsedAt).toBe(lastAccessed);
  });
  it('archives a long URL even when the browser has no page title', async () => {
    const url = `https://example.com/?query=${'a'.repeat(3000)}`;
    const f = await fixture([tab({ url, title: '' })]);
    await f.endGrace();
    await f.service.cleanup();
    expect(f.tabs.close).toHaveBeenCalledWith(1);
    expect((await f.store.archives())[0]).toMatchObject({
      url,
      title: url.slice(0, 2000),
    });
  });
  it('waits five minutes on installation then uses existing tab age', async () => {
    const f = await fixture();
    for (let minute = 0; minute < 5; minute++) {
      await f.service.cleanup();
      expect(f.tabs.close).not.toHaveBeenCalled();
      f.advance(MINUTE);
    }
    await f.service.cleanup();
    expect(f.tabs.close).toHaveBeenCalledWith(1);
    expect(await f.store.archives()).toHaveLength(1);
  });
  it('counts sleep but grants five minutes after a missed heartbeat', async () => {
    const f = await fixture([tab({ lastAccessed: NOW - 6 * DAY })]);
    await f.endGrace();
    f.advance(2 * DAY);
    await f.service.cleanup();
    expect(f.tabs.close).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) {
      f.advance(MINUTE);
      await f.service.cleanup();
    }
    expect(f.tabs.close).toHaveBeenCalledWith(1);
  });
  it('persists the link before calling the browser close API', async () => {
    const f = await fixture();
    await f.endGrace();
    f.tabs.close.mockImplementation(async () => {
      expect(await f.store.archives()).toEqual([
        expect.objectContaining({ url: tab().url, outcome: 'saved' }),
      ]);
    });
    await f.service.cleanup();
    expect((await f.store.archives())[0]?.outcome).toBe('closed');
  });
  it('does not close a tab after a failed archive write', async () => {
    const f = await fixture();
    await f.endGrace();
    vi.spyOn(f.store, 'saveArchives').mockRejectedValue(
      new Error('Quota exceeded'),
    );
    await f.service.cleanup();
    expect(f.tabs.close).not.toHaveBeenCalled();
    expect((await f.store.session())?.error).toContain('Cleanup stopped');
  });
  it.each([
    { active: true },
    { pinned: true },
    { audible: true },
    { highlighted: true },
    { url: 'https://example.org/changed' },
    { lastAccessed: NOW },
    { loading: true },
  ])('revalidates the tab before closing: %j', async (change) => {
    const f = await fixture();
    await f.endGrace();
    f.tabs.get.mockResolvedValue(tab(change));
    await f.service.cleanup();
    expect(f.tabs.close).not.toHaveBeenCalled();
    expect(await f.store.archives()).toHaveLength(1);
  });
  it('handles a tab that disappears during cleanup', async () => {
    const f = await fixture();
    await f.endGrace();
    f.tabs.get.mockResolvedValue(undefined);
    await f.service.cleanup();
    expect(f.tabs.close).not.toHaveBeenCalled();
  });
  it('reads the settings again before closing', async () => {
    const f = await fixture();
    await f.endGrace();
    vi.spyOn(f.store, 'settings')
      .mockResolvedValueOnce(DEFAULT_SETTINGS)
      .mockResolvedValue({ ...DEFAULT_SETTINGS, enabled: false });
    await f.service.cleanup();
    expect(f.tabs.close).not.toHaveBeenCalled();
  });
  it('reuses a saved operation after a failed close and worker restart', async () => {
    const f = await fixture();
    await f.endGrace();
    f.tabs.close.mockRejectedValueOnce(new Error('Tab is being dragged'));
    await f.service.cleanup();
    const [first] = await f.store.archives();
    const resumed = createService(f.dependencies);
    await resumed.initialize();
    await resumed.cleanup();
    expect(await f.store.archives()).toEqual([
      expect.objectContaining({ id: first?.id, outcome: 'closed' }),
    ]);
    expect(f.tabs.close).toHaveBeenCalledTimes(2);
  });
  it('retains a saved link if finalization fails after closing, without replaying the close', async () => {
    const f = await fixture();
    await f.endGrace();
    vi.spyOn(f.store, 'recordClosure').mockRejectedValueOnce(
      new Error('Worker stopped'),
    );
    await f.service.cleanup();
    const resumed = createService(f.dependencies);
    await resumed.initialize();
    await resumed.cleanup();
    expect(f.tabs.close).toHaveBeenCalledTimes(1);
    expect(await f.store.archives()).toHaveLength(1);
    expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 0 });
  });
  it('never assigns old activity to a reused tab ID after browser startup', async () => {
    const f = await fixture();
    await f.endGrace();
    f.live.set(1, tab({ lastAccessed: undefined }));
    await f.service.initialize(true);
    expect((await f.store.session())?.observations['1']?.lastUsedAt).toBe(NOW);
    await f.endGrace();
    await f.service.cleanup();
    expect(f.tabs.close).not.toHaveBeenCalled();
  });
  it('ordinary worker initialization does not prolong startup grace', async () => {
    const f = await fixture();
    const before = (await f.store.session())!.graceUntil;
    f.advance(MINUTE);
    await createService(f.dependencies).initialize();
    expect((await f.store.session())!.graceUntil).toBe(before);
  });
  it('bounds cleanup to 25 tabs per alarm', async () => {
    const f = await fixture(
      Array.from({ length: 30 }, (_, index) => tab({ id: index + 1 })),
    );
    await f.endGrace();
    await f.service.cleanup();
    expect(f.tabs.close).toHaveBeenCalledTimes(25);
    f.advance(MINUTE);
    await f.service.cleanup();
    expect(f.tabs.close).toHaveBeenCalledTimes(30);
    expect(await f.store.statistics()).toEqual({ lifetimeArchivedTabs: 30 });
  });
  it('keeps all live tabs when observation persistence fails', async () => {
    const f = await fixture();
    await f.endGrace();
    vi.spyOn(f.store, 'saveSession').mockRejectedValue(
      new Error('Storage unavailable'),
    );
    await expect(f.service.cleanup()).rejects.toThrow();
    expect(f.tabs.close).not.toHaveBeenCalled();
  });
});

describe('archive workflows', () => {
  async function archived() {
    const f = await fixture();
    await f.endGrace();
    await f.service.cleanup();
    return f;
  }
  it('reopens without deleting the archive entry', async () => {
    const f = await archived();
    const [entry] = await f.store.archives();
    await f.service.handle({ type: 'reopen', id: entry!.id });
    expect(f.tabs.open).toHaveBeenCalledWith(tab().url);
    expect(await f.store.archives()).toHaveLength(1);
  });
  it('round-trips backups and deduplicates IDs without importing settings', async () => {
    const f = await archived();
    const backup = await f.service.handle({ type: 'export' });
    const target = await fixture([]);
    backup.settings.inactivityDays = 99;
    const result = await target.service.handle({ type: 'import', backup });
    expect(result).toEqual({ imported: 1 });
    expect(await target.service.handle({ type: 'import', backup })).toEqual({
      imported: 0,
    });
    expect((await target.store.settings()).inactivityDays).toBe(7);
    expect((await target.store.archives())[0]?.operationKey).toBeUndefined();
  });
  it('exports the tabbye format and still accepts pre-rename backups', async () => {
    const f = await archived();
    const backup = await f.service.handle({ type: 'export' });
    expect(backup.format).toBe('tabbye');
    expect(
      backupSchema.safeParse({ ...backup, format: 'autotabs' }).success,
    ).toBe(true);
    expect(backupSchema.safeParse({ ...backup, format: 'other' }).success).toBe(
      false,
    );
  });
  it('searches case-insensitively and clamps pages after deletions', async () => {
    const f = await archived();
    const result = await f.service.handle({
      type: 'view',
      query: 'USEFUL',
      page: 100,
      pageSize: 20,
    });
    expect(result).toMatchObject({ matching: 1, page: 1, total: 1 });
    const [entry] = await f.store.archives();
    await f.service.handle({ type: 'delete', id: entry!.id });
    expect(await f.store.archives()).toHaveLength(0);
  });
});
