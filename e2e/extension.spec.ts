import { test, expect } from './fixtures';
import type { browser } from 'wxt/browser';
import type { SessionState } from '../src/domain/model';

declare const chrome: typeof browser;

test('popup, settings, import, search, reopen, and delete work in the production extension', async ({
  extension,
}, testInfo) => {
  const { context, id } = extension;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await expect(page.getByText('No archived tabs yet')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Lifetime tabs archived' })
      .locator('strong'),
  ).toHaveText('0');
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Paused')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('popup.png') });
  const settingsPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = await settingsPromise;
  await expect(settings).toHaveURL(`chrome-extension://${id}/options.html`);
  await expect(
    settings.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await settings.close();
  await page.goto(`chrome-extension://${id}/archive.html#settings`);
  await page.getByLabel('Archive after', { exact: true }).fill('14');
  await page
    .getByLabel('Excluded websites', { exact: true })
    .fill('work.example.com');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  const entryId = crypto.randomUUID();
  const backup = {
    format: 'autotabs',
    version: 1,
    exportedAt: Date.now(),
    settings: { enabled: true, inactivityDays: 99, excludedDomains: [] },
    entries: [
      {
        id: entryId,
        title: 'Designing reliable systems',
        url: 'https://example.com/reliability',
        lastUsedAt: Date.now(),
        archivedAt: Date.now(),
        outcome: 'closed',
      },
      {
        id: crypto.randomUUID(),
        title: 'A guide to urban gardens',
        url: 'https://example.org/gardens',
        lastUsedAt: Date.now(),
        archivedAt: Date.now() - 1000,
        outcome: 'closed',
      },
    ],
  };
  await page.getByLabel('Import backup file').setInputFiles({
    name: 'legacy-autotabs.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(
    page.getByText('2 links imported. Existing links and settings were kept.'),
  ).toBeVisible();
  await expect(page.getByLabel('Archive after', { exact: true })).toHaveValue(
    '14',
  );
  await page.screenshot({
    path: testInfo.outputPath('settings.png'),
    fullPage: true,
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const popupSearch = popup.getByRole('searchbox', {
    name: 'Search archived links',
  });
  await expect(popupSearch).toBeFocused();
  await popupSearch.fill('gardens');
  await expect(
    popup.getByRole('button', {
      name: 'A guide to urban gardens',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    popup.getByRole('button', {
      name: 'Designing reliable systems',
      exact: true,
    }),
  ).toHaveCount(0);
  await popupSearch.press('Escape');
  await expect(popupSearch).toHaveValue('');
  await expect(
    popup.getByRole('button', {
      name: 'Designing reliable systems',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    popup
      .getByRole('region', { name: 'Lifetime tabs archived' })
      .locator('strong'),
  ).toHaveText('0');
  await popup.screenshot({ path: testInfo.outputPath('popup-with-links.png') });
  await popup.close();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Designing reliable systems',
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('archive.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: testInfo.outputPath('archive-dark.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 420, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('archive-narrow.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel('Search archived links').fill('reliable');
  await expect(
    page.getByRole('button', { name: 'A guide to urban gardens', exact: true }),
  ).toHaveCount(0);
  // Fulfill the reopened URL locally: this test must not need external websites.
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ body: '<title>Reopened article</title>' }),
  );
  const openedPromise = context.waitForEvent('page');
  await page
    .getByRole('button', { name: 'Reopen Designing reliable systems' })
    .click();
  const opened = await openedPromise;
  await expect(opened).toHaveURL('https://example.com/reliability');
  await expect(
    page.getByRole('button', {
      name: 'Designing reliable systems',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete Designing reliable systems' })
    .click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('No matching links')).toBeVisible();
  expect(errors).toEqual([]);
});

test('declares the options page and shortcut, and reuses an open archive tab', async ({
  extension,
}) => {
  const { context, id, worker } = extension;
  expect(
    await worker.evaluate(() => chrome.runtime.getManifest()),
  ).toMatchObject({
    options_ui: { page: 'options.html', open_in_tab: true },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+T' } },
    },
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const openArchive = popup.getByRole('button', { name: 'Open archive' });
  const archiveUrl = `chrome-extension://${id}/archive.html`;
  const opened = context.waitForEvent('page');
  await openArchive.click();
  await expect(await opened).toHaveURL(archiveUrl);
  await expect(openArchive).toBeEnabled();
  await openArchive.click();
  await expect(openArchive).toBeEnabled();
  expect(
    context.pages().filter((page) => page.url().startsWith(archiveUrl)),
  ).toHaveLength(1);
});

test('the production worker restarts without losing data or resetting grace', async ({
  extension,
}) => {
  const { context, id } = extension;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/archive.html`);
  await expect(page.getByText('No archived tabs yet')).toBeVisible();
  const grace = await page.evaluate(
    async () =>
      ((await chrome.storage.session.get('session')).session as SessionState)
        .graceUntil,
  );
  const cdp = await context.newCDPSession(page);
  const versions: {
    versionId: string;
    scriptURL: string;
    runningStatus: string;
  }[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updated }) =>
    versions.push(...updated),
  );
  await cdp.send('ServiceWorker.enable');
  await expect
    .poll(
      () =>
        versions.find(
          (version) =>
            version.scriptURL === `chrome-extension://${id}/background.js`,
        )?.versionId,
    )
    .toBeTruthy();
  const version = versions.find(
    (value) => value.scriptURL === `chrome-extension://${id}/background.js`,
  )!;
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  // Sending a normal message wakes the worker; there is no development keepalive.
  const reply: unknown = await page.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'view',
      query: '',
      page: 1,
      pageSize: 20,
    }),
  );
  expect(reply).toMatchObject({
    ok: true,
    value: { graceUntil: grace, total: 0 },
  });
  await cdp.detach();
});
