import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANGED_MESSAGE } from '../src/application/protocol';
import { DEFAULT_SETTINGS } from '../src/domain/model';
import { MemoryArea, tab } from './helpers';

function event<Args extends unknown[]>() {
  const listeners: ((...args: Args) => unknown)[] = [];
  return {
    listeners,
    addListener: (listener: (...args: Args) => unknown) => {
      listeners.push(listener);
    },
    fire: (...args: Args) => listeners.map((listener) => listener(...args)),
  };
}
type Sender = { id: string; url?: string; tab?: { incognito: boolean } };

async function boot(local = new MemoryArea(), session = new MemoryArea()) {
  vi.resetModules();
  const onMessage = event<[unknown, Sender, (reply: unknown) => void]>();
  const onAlarm = event<[{ name: string }]>();
  const onActivated = event<[]>();
  const createAlarm = vi.fn(async () => undefined);
  const api = {
    storage: {
      local: Object.assign(local, {
        setAccessLevel: vi.fn(async () => undefined),
      }),
      session,
    },
    runtime: {
      id: 'test-extension',
      getURL: (path: string) =>
        `chrome-extension://test-extension/${path.replace(/^\//, '')}`,
      onMessage,
      onInstalled: event<[]>(),
      onStartup: event<[]>(),
      sendMessage: vi.fn(async () => undefined),
    },
    alarms: { onAlarm, get: vi.fn(async () => undefined), create: createAlarm },
    tabs: {
      query: vi.fn(async () => [
        { ...tab({ lastAccessed: Date.now() - 1000.375 }), status: 'complete' },
      ]),
      get: vi.fn(async () => ({
        ...tab({ lastAccessed: Date.now() - 1000.375 }),
        status: 'complete',
      })),
      remove: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      onActivated,
      onCreated: event<[]>(),
      onRemoved: event<[]>(),
      onReplaced: event<[]>(),
      onAttached: event<[]>(),
      onDetached: event<[]>(),
      onUpdated: event<[number, Record<string, unknown>]>(),
    },
    windows: { get: vi.fn(async () => ({ type: 'normal' })) },
  };
  vi.doMock('wxt/browser', () => ({ browser: api }));
  const background = (await import('../src/entrypoints/background')).default;
  background.main();
  const sender = {
    id: 'test-extension',
    url: 'chrome-extension://test-extension/archive.html',
  };
  function message(command: unknown) {
    return new Promise<unknown>((resolve) =>
      onMessage.fire(command, sender, resolve),
    );
  }
  // Also drains initialization: all work shares the actual background queue.
  await message({ type: 'view', query: '', page: 1, pageSize: 20 });
  return { api, message, local, session };
}

afterEach(() => {
  vi.doUnmock('wxt/browser');
  vi.unstubAllEnvs();
});

describe('background runtime wiring', () => {
  it('emits task profiles only in explicitly instrumented builds', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await boot();
    expect(log).not.toHaveBeenCalled();
    vi.stubEnv('WXT_PROFILE', 'true');
    const { message } = await boot();
    await message({ type: 'settings', settings: { enabled: false } });
    // Replies are delivered before the enclosing task's finally block emits its profile.
    await vi.waitFor(() => expect(log.mock.calls).toHaveLength(3));
    const samples = log.mock.calls
      .filter(([prefix]) => prefix === 'tabbye:profile')
      .map(
        ([, json]) =>
          JSON.parse(json as string) as {
            task: string;
            firstTaskInWorker: boolean;
          },
      );
    expect(samples.map((sample) => sample.task)).toEqual([
      'worker startup',
      'view',
      'settings',
    ]);
    expect(samples.filter((sample) => sample.firstTaskInWorker)).toHaveLength(
      1,
    );
    expect(JSON.stringify(samples)).not.toContain('example.com');
  });
  it('registers message handlers, restricts storage access, and recreates a missing alarm', async () => {
    const { api, message } = await boot();
    expect(api.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(api.alarms.create).toHaveBeenCalledWith('tabbye-cleanup', {
      periodInMinutes: 1,
    });
    expect(
      await message({ type: 'view', query: '', page: 1, pageSize: 20 }),
    ).toMatchObject({
      ok: true,
      value: { settings: DEFAULT_SETTINGS, total: 0 },
    });
  });
  it('rejects invalid requests and ignores messages from websites or other extensions', async () => {
    const { api, message } = await boot();
    expect(await message({ type: 'deleteEverything' })).toMatchObject({
      ok: false,
    });
    const respond = vi.fn();
    expect(
      api.runtime.onMessage.fire(
        { type: 'export' },
        { id: 'test-extension', url: 'https://example.com' },
        respond,
      ),
    ).toEqual([false]);
    expect(
      api.runtime.onMessage.fire(
        { type: 'export' },
        { id: 'other', url: 'chrome-extension://test-extension/archive.html' },
        respond,
      ),
    ).toEqual([false]);
    expect(respond).not.toHaveBeenCalled();
    expect(
      api.runtime.onMessage.fire(
        { type: 'skip-wait' },
        { id: 'test-extension', url: 'https://example.com' },
        respond,
      ),
    ).toEqual([false]);
    expect(respond).not.toHaveBeenCalled();
    expect(await message({ type: 'skip-wait', force: true })).toMatchObject({
      ok: false,
    });
  });
  it('accepts the skip-wait command through the normal message queue', async () => {
    const { api, message, session } = await boot();
    const before = (await session.get('session')).session as {
      graceUntil: number;
    };
    expect(before.graceUntil).toBeGreaterThan(Date.now());
    expect(await message({ type: 'skip-wait' })).toEqual({
      ok: true,
      value: null,
    });
    const after = (await session.get('session')).session as {
      graceUntil: number;
    };
    expect(after.graceUntil).toBeLessThanOrEqual(Date.now());
    expect(api.tabs.remove).not.toHaveBeenCalled();
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: CHANGED_MESSAGE,
    });
  });
  it('refreshes open pages after cleanup but not after tab activity', async () => {
    const { api, message } = await boot();
    api.runtime.sendMessage.mockClear();
    api.tabs.onActivated.fire();
    // Views do not notify; awaiting one drains the activity task from the queue.
    await message({ type: 'view', query: '', page: 1, pageSize: 20 });
    expect(api.runtime.sendMessage).not.toHaveBeenCalled();
    api.alarms.onAlarm.fire({ name: 'tabbye-cleanup' });
    await message({ type: 'view', query: '', page: 1, pageSize: 20 });
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: CHANGED_MESSAGE,
    });
  });
  it('keeps persisted settings and grace through an ordinary worker restart', async () => {
    const first = await boot();
    await first.message({
      type: 'settings',
      settings: { ...DEFAULT_SETTINGS, inactivityDays: 21 },
    });
    const before = await first.session.get('session');
    const second = await boot(first.local, first.session);
    expect(
      await second.message({ type: 'view', query: '', page: 1, pageSize: 20 }),
    ).toMatchObject({ ok: true, value: { settings: { inactivityDays: 21 } } });
    expect((await second.session.get('session')).session).toMatchObject({
      graceUntil: (before.session as { graceUntil: number }).graceUntil,
    });
  });
  it('serializes settings changes from two extension pages', async () => {
    const { message } = await boot();
    const first = message({ type: 'settings', settings: { enabled: false } });
    const second = message({
      type: 'settings',
      settings: { inactivityDays: 30 },
    });
    await Promise.all([first, second]);
    expect(
      await message({ type: 'view', query: '', page: 1, pageSize: 20 }),
    ).toMatchObject({
      ok: true,
      value: { settings: { inactivityDays: 30, enabled: false } },
    });
  });
});
