import type { browser } from 'wxt/browser';
import { test, expect } from './fixtures';
import {
  drainEvents,
  FIXTURE_ORIGIN,
  prepareCleanup,
  readProtectionState,
  runCleanup,
} from './protection-helpers';

declare const chrome: typeof browser;

for (const trigger of ['alarm', 'skip-wait'] as const) {
  test(`tab protection: ${trigger} preserves expired pins and releases them after unpinning`, async ({
    extension,
  }, testInfo) => {
    const { context, id, worker } = extension;
    const evidence: {
      phase: string;
      state: Awaited<ReturnType<typeof readProtectionState>>;
    }[] = [];
    try {
      await context.route(`${FIXTURE_ORIGIN}/**`, (route) => {
        const name = new URL(route.request().url()).pathname.slice(1);
        return route.fulfill({
          contentType: 'text/html',
          body: `<title>Test ${name}</title><p>Local browser fixture</p>`,
        });
      });
      const stale = await context.newPage();
      await stale.goto(`${FIXTURE_ORIGIN}/stale`);
      const pinned = await context.newPage();
      await pinned.goto(`${FIXTURE_ORIGIN}/pinned`);
      const active = await context.newPage();
      await active.goto(`${FIXTURE_ORIGIN}/active`);
      const control = await context.newPage();
      await control.goto(`chrome-extension://${id}/archive.html`);
      await drainEvents(control);
      await control.evaluate(async (origin) => {
        const [pinned] = await chrome.tabs.query({ url: `${origin}/pinned` });
        const [active] = await chrome.tabs.query({ url: `${origin}/active` });
        await chrome.tabs.update(pinned!.id, { pinned: true });
        await chrome.tabs.update(active!.id, { active: true });
      }, FIXTURE_ORIGIN);

      const checkTime = await prepareCleanup(control, worker, trigger);
      const before = await readProtectionState(control);
      evidence.push({ phase: 'before cleanup', state: before });
      expect(before.statistics.lifetimeArchivedTabs).toBe(0);
      expect(before.entries).toEqual([]);
      const pinnedBefore = before.tabs.find((tab) => tab.url === pinned.url());
      const staleBefore = before.tabs.find((tab) => tab.url === stale.url());
      // A fresh, selected, or loading pinned tab would survive for another reason.
      for (const tab of [pinnedBefore, staleBefore]) {
        expect(tab).toMatchObject({
          active: false,
          highlighted: false,
          audible: false,
          status: 'complete',
        });
        expect(tab!.pendingUrl).toBeFalsy();
        expect(tab!.lastAccessed).toBeLessThan(
          checkTime - 7 * 24 * 60 * 60 * 1000,
        );
      }
      expect(pinnedBefore!.pinned).toBe(true);
      expect(staleBefore!.pinned).toBe(false);
      expect(before.tabs.find((tab) => tab.url === active.url())?.active).toBe(
        true,
      );

      await runCleanup(control, trigger, checkTime);
      const after = await readProtectionState(control);
      evidence.push({ phase: 'after cleanup', state: after });
      expect(stale.isClosed()).toBe(true);
      expect(pinned.isClosed()).toBe(false);
      expect(active.isClosed()).toBe(false);
      expect(after.entries).toEqual([
        expect.objectContaining({
          url: `${FIXTURE_ORIGIN}/stale`,
          outcome: 'closed',
        }),
      ]);
      expect(after.statistics.lifetimeArchivedTabs).toBe(1);

      // A second ordinary tab shows that cleanup really ran after unpinning.
      const secondControl = await context.newPage();
      await secondControl.goto(`${FIXTURE_ORIGIN}/second-control`);
      await control.evaluate(async (origin) => {
        const [pinned] = await chrome.tabs.query({ url: `${origin}/pinned` });
        const [active] = await chrome.tabs.query({ url: `${origin}/active` });
        await chrome.tabs.update(pinned!.id, { pinned: false });
        await chrome.tabs.update(active!.id, { active: true });
      }, FIXTURE_ORIGIN);
      const nextCheckTime = await prepareCleanup(control, worker, trigger);
      const unpinned = await readProtectionState(control);
      evidence.push({ phase: 'before unpinned cleanup', state: unpinned });
      expect(
        unpinned.tabs.find((tab) => tab.url === pinned.url()),
      ).toMatchObject({
        pinned: false,
        active: false,
        highlighted: false,
        audible: false,
        status: 'complete',
      });
      await runCleanup(control, trigger, nextCheckTime);
      const released = await readProtectionState(control);
      evidence.push({ phase: 'after unpinned cleanup', state: released });
      expect(pinned.isClosed()).toBe(true);
      expect(secondControl.isClosed()).toBe(true);
      expect(active.isClosed()).toBe(false);
      expect(released.entries.map((entry) => entry.url).sort()).toEqual([
        `${FIXTURE_ORIGIN}/pinned`,
        `${FIXTURE_ORIGIN}/second-control`,
        `${FIXTURE_ORIGIN}/stale`,
      ]);
      expect(
        released.entries.every((entry) => entry.outcome === 'closed'),
      ).toBe(true);
      expect(
        new Set(released.entries.map((entry) => entry.operationKey)).size,
      ).toBe(3);
      expect(released.statistics.lifetimeArchivedTabs).toBe(3);

      // Deleting a saved link must not lower the lifetime total, and the UI
      // should update from the real worker writes.
      await control.getByRole('button', { name: 'Delete Test stale' }).click();
      await control.getByRole('button', { name: 'Confirm delete' }).click();
      await expect(
        control.getByRole('button', { name: 'Test stale', exact: true }),
      ).toHaveCount(0);
      await expect(
        control
          .getByRole('region', { name: 'Lifetime tabs archived' })
          .locator('strong'),
      ).toHaveText('3');
    } finally {
      await testInfo.attach('tab-protection-evidence', {
        body: JSON.stringify({ trigger, phases: evidence }, null, 2),
        contentType: 'application/json',
      });
    }
  });
}
