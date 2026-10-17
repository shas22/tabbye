import type { Page, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import {
  archiveSchema,
  lifetimeStatsSchema,
  type SessionState,
} from '../src/domain/model';
import { expect } from './fixtures';

declare const chrome: typeof browser;

export type CleanupTrigger = 'alarm' | 'skip-wait';
export const FIXTURE_ORIGIN = 'https://example.test';

/** A normal request waits behind earlier work on the worker's serialized queue. */
export async function drainEvents(control: Page) {
  const reply: unknown = await control.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'view',
      query: '',
      page: 1,
      pageSize: 20,
    }),
  );
  expect(reply).toMatchObject({ ok: true });
}

export async function readProtectionState(control: Page) {
  const state = await control.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    const local = await chrome.storage.local.get(null);
    const session = (await chrome.storage.session.get('session'))
      .session as SessionState;
    return {
      tabs: tabs
        .filter((tab) => tab.url?.startsWith(`${origin}/`))
        .map((tab) => ({
          id: tab.id,
          url: tab.url,
          pinned: tab.pinned,
          active: tab.active,
          highlighted: tab.highlighted,
          audible: tab.audible ?? false,
          status: tab.status,
          pendingUrl: tab.pendingUrl,
          lastAccessed: tab.lastAccessed,
          groupId: tab.groupId,
          discarded: tab.discarded,
          lastUsedAt:
            tab.id === undefined
              ? undefined
              : session.observations[tab.id]?.lastUsedAt,
        })),
      entries: Object.entries(local)
        .filter(([key]) => key.startsWith('archive:'))
        .map(([, value]) => value),
      statistics: local.statistics,
      lastCleanupAt: session.lastCleanupAt,
      error: session.error,
    };
  }, FIXTURE_ORIGIN);
  return {
    ...state,
    entries: state.entries.map((entry) => archiveSchema.parse(entry)),
    statistics: lifetimeStatsSchema.parse(state.statistics),
  };
}

export async function prepareCleanup(
  control: Page,
  worker: Worker,
  trigger: CleanupTrigger,
) {
  await drainEvents(control);
  // Change only the disposable worker's clock. Browser timestamps stay real,
  // so even newly created inactive tabs are genuinely expired to the service.
  const future = Date.now() + 8 * 24 * 60 * 60 * 1000;
  await worker.evaluate(
    async ({ future, trigger }) => {
      await chrome.alarms.clear('tabbye-cleanup');
      Date.now = () => future;
      const session = (await chrome.storage.session.get('session'))
        .session as SessionState;
      await chrome.storage.session.set({
        session: {
          ...session,
          observations: {},
          graceUntil: trigger === 'skip-wait' ? future + 5 * 60 * 1000 : 0,
          lastCheckAt: future,
        },
      });
    },
    { future, trigger },
  );
  return future;
}

export async function runCleanup(
  control: Page,
  trigger: CleanupTrigger,
  checkTime: number,
) {
  if (trigger === 'alarm') {
    // Schedule against the page's real clock, not the worker's advanced clock.
    await control.evaluate(() =>
      chrome.alarms.create('tabbye-cleanup', { when: Date.now() + 100 }),
    );
  } else {
    // This is the same validated command sent by the Skip wait button.
    const reply: unknown = await control.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'skip-wait' }),
    );
    expect(reply).toMatchObject({ ok: true });
  }
  // Waiting for a tab's close event alone can race the archive/statistics write.
  await expect
    .poll(async () => {
      const state = await readProtectionState(control);
      return { lastCleanupAt: state.lastCleanupAt, error: state.error };
    })
    .toEqual({ lastCleanupAt: checkTime, error: null });
  await drainEvents(control);
}
