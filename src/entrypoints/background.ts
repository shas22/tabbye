import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { CHANGED_MESSAGE, commandSchema } from '../application/protocol';
import { createQueue } from '../application/queue';
import { createService } from '../application/service';
import { failureSummary } from '../application/failures';
import { browserTabs } from '../platform/browser';
import { createStore } from '../platform/storage';
import { createWorkerProfiler } from '../platform/profiling';

const ALARM = 'tabbye-cleanup';

export default defineBackground(() => {
  const enqueue = createQueue();
  // Vite removes the profiler and its adapters entirely from ordinary builds.
  const profiler =
    import.meta.env.WXT_PROFILE === 'true'
      ? createWorkerProfiler({
          emit: (sample) =>
            console.info('tabbye:profile', JSON.stringify(sample)),
        })
      : undefined;
  const service = createService({
    tabs: profiler?.trackTabs(browserTabs) ?? browserTabs,
    store: createStore(
      profiler?.trackStorage(browser.storage.local, 'local') ??
        browser.storage.local,
      profiler?.trackStorage(browser.storage.session, 'session') ??
        browser.storage.session,
    ),
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
  });
  let ready: Promise<void> | undefined;

  function measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    return profiler ? profiler.measure(name, work) : work();
  }

  function initialize() {
    // Initialize once per worker, but retry on the next event if initialization failed.
    ready ??= (async () => {
      await browser.storage.local.setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
      await service.initialize();
      if (!(await browser.alarms.get(ALARM)))
        await browser.alarms.create(ALARM, { periodInMinutes: 1 });
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  }

  async function broadcast() {
    await browser.runtime
      .sendMessage({ type: CHANGED_MESSAGE })
      .catch(() => undefined);
  }

  function event(name: string, work: () => Promise<void>, notify = true) {
    let stage = 'initialization';
    void enqueue(() =>
      measure(name, async () => {
        await initialize();
        stage = name;
        await work();
        if (notify) await broadcast();
      }),
    ).catch((error: unknown) => {
      // Never log tab titles, URLs, imported data, or raw storage errors.
      console.error(`Tabbye ${stage} failed. ${failureSummary(error)}`);
    });
  }

  // Tab activity only updates session observations, which pages never display,
  // so it does not make open pages reload the archive.
  function activity(name: string) {
    event(name, service.activity, false);
  }

  // Register synchronously: Chrome discovers wake-up listeners before async initialization.
  browser.runtime.onInstalled.addListener(() =>
    event('installation', () => service.initialize(true)),
  );
  browser.runtime.onStartup.addListener(() =>
    event('browser startup', () => service.initialize(true)),
  );
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) event('cleanup', service.cleanup);
  });
  browser.tabs.onActivated.addListener(() => activity('tab activation'));
  browser.tabs.onCreated.addListener(() => activity('tab creation'));
  browser.tabs.onRemoved.addListener(() => activity('tab removal'));
  browser.tabs.onReplaced.addListener(() => activity('tab replacement'));
  browser.tabs.onAttached.addListener(() => activity('tab attachment'));
  browser.tabs.onDetached.addListener(() => activity('tab detachment'));
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (
      change.url !== undefined ||
      change.status !== undefined ||
      change.pinned !== undefined ||
      change.audible !== undefined
    )
      activity('tab update');
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      const prefix = browser.runtime.getURL('/');
      if (
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(prefix) ||
        sender.tab?.incognito
      )
        return false;
      const parsed = commandSchema.safeParse(message);
      if (!parsed.success) {
        sendResponse({
          ok: false,
          error: 'Invalid request. Reload the extension page and try again.',
        });
        return false;
      }
      void enqueue(() =>
        measure(parsed.data.type, async () => {
          await initialize();
          const value = await service.handle(parsed.data);
          if (parsed.data.type !== 'view' && parsed.data.type !== 'export')
            await broadcast();
          sendResponse({ ok: true, value });
        }),
      ).catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: `The action could not be completed. ${failureSummary(error)}`,
        }),
      );
      return true;
    },
  );

  event('worker startup', () => Promise.resolve());
});
