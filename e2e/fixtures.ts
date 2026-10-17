import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { resolve, join } from 'node:path';

export interface ExtensionFixture {
  context: BrowserContext;
  id: string;
  worker: Worker;
}

export const test = base.extend<{ extension: ExtensionFixture }>({
  extension: async ({ browserName }, use, testInfo) => {
    if (browserName !== 'chromium')
      throw new Error('Extension tests require Chromium.');
    const profile = await mkdtemp(join(tmpdir(), 'tabbye-e2e-'));
    const extensionPath = resolve('.output/chrome-mv3');
    const executablePath = process.env.TABBYE_CHROMIUM_PATH;
    const headless = process.env.TABBYE_HEADED !== '1';
    let context: BrowserContext | undefined;
    const evidence = {
      date: new Date().toISOString(),
      os: { platform: platform(), release: release(), arch: arch() },
      executablePath: executablePath ?? chromium.executablePath(),
      headless,
      engineVersion: null as string | null,
      extensionId: null as string | null,
    };
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        executablePath,
        headless,
        // Fail before the 30 s test timeout so a browser that never connects
        // still reaches `finally`, which records evidence and removes the profile.
        timeout: 20_000,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });
      evidence.engineVersion = context.browser()?.version() ?? null;
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).hostname;
      evidence.extensionId = id;
      await use({ context, id, worker });
    } finally {
      // Include launch details even when the browser exits before loading Tabbye.
      await testInfo.attach('browser-environment', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
      try {
        await context?.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  },
});

export { expect };
