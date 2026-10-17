// Regenerates the README screenshots from the production build with sample data.
// Run `bun run build` first. Uses a disposable profile; never a personal one.
import { chromium, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { browser } from 'wxt/browser';
import { DAY, type ArchivedLink } from '../src/domain/model';

declare const chrome: typeof browser;

const OUTPUT = 'docs/images';
const now = Date.now();
const samples: [title: string, url: string, daysAgo: number][] = [
  [
    'Extension service worker lifecycle',
    'https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle',
    0,
  ],
  [
    'Hexagonal architecture',
    'https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)',
    0,
  ],
  ['Basic types · Zod', 'https://zod.dev/api', 0],
  [
    'Keeping components pure – React',
    'https://react.dev/learn/keeping-components-pure',
    1,
  ],
  ['Interaction to Next Paint (INP)', 'https://web.dev/articles/inp', 1],
  ['Release notes · wxt-dev/wxt', 'https://github.com/wxt-dev/wxt/releases', 3],
  [
    'Fallacies of distributed computing',
    'https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing',
    3,
  ],
];
const entries: ArchivedLink[] = samples.map(([title, url, daysAgo], index) => ({
  id: crypto.randomUUID(),
  title,
  url,
  lastUsedAt: now - (daysAgo + 8) * DAY - index * 3_600_000,
  archivedAt: now - daysAgo * DAY - index * 1_800_000,
  outcome: 'closed',
}));

async function capture(page: Page, name: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.locator('.app').screenshot({
      path: join(OUTPUT, `${name}-${colorScheme}.png`),
    });
  }
}

const profile = await mkdtemp(join(tmpdir(), 'tabbye-screenshots-'));
const extensionPath = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  deviceScaleFactor: 2,
  viewport: { width: 1120, height: 720 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  // Wait for the worker to initialize storage before seeding it.
  await page.goto(`chrome-extension://${id}/archive.html`);
  await page.getByText('No archived tabs yet').waitFor();
  await page.evaluate(async (seed) => {
    await chrome.storage.local.set({
      statistics: { lifetimeArchivedTabs: 248 },
      ...Object.fromEntries(
        seed.map((entry) => [`archive:${entry.id}`, entry]),
      ),
    });
    const { session } = await chrome.storage.session.get('session');
    // Show the steady state rather than the post-install countdown.
    await chrome.storage.session.set({
      session: { ...(session as object), graceUntil: 0 },
    });
  }, entries);
  await mkdir(OUTPUT, { recursive: true });

  await page.reload();
  await page
    .getByRole('button', { name: entries[0]!.title, exact: true })
    .waitFor();
  await capture(page, 'archive');

  await page.goto(`chrome-extension://${id}/popup.html`);
  await page
    .getByRole('button', { name: entries[0]!.title, exact: true })
    .waitFor();
  await page.getByRole('searchbox').blur();
  await capture(page, 'popup');
  console.log(`Screenshots written to ${OUTPUT}/`);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
