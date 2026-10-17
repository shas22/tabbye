import { browser, type Browser } from 'wxt/browser';
import type { Tabs } from '../application/ports';
import type { TabSnapshot } from '../domain/model';

function snapshot(tab: Browser.tabs.Tab, normalWindow: boolean): TabSnapshot {
  if (tab.id === undefined)
    throw new Error('Browser returned a tab without an identity.');
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url ?? '',
    title: tab.title ?? '',
    lastAccessed: tab.lastAccessed,
    active: tab.active,
    pinned: tab.pinned,
    highlighted: tab.highlighted,
    audible: tab.audible ?? false,
    incognito: tab.incognito,
    loading: tab.status === 'loading' || Boolean(tab.pendingUrl),
    normalWindow,
  };
}

export const browserTabs: Tabs = {
  async list() {
    return (await browser.tabs.query({ windowType: 'normal' }))
      .filter((tab) => tab.id !== undefined && !tab.incognito)
      .map((tab) => snapshot(tab, true));
  },
  async get(id) {
    try {
      const tab = await browser.tabs.get(id);
      const window = await browser.windows.get(tab.windowId);
      return snapshot(tab, window.type === 'normal');
    } catch (error) {
      if (
        error instanceof Error &&
        /No tab with id|No window with id|Invalid tab ID/i.test(error.message)
      )
        return undefined;
      throw error;
    }
  },
  async close(id) {
    await browser.tabs.remove(id);
  },
  async open(url) {
    await browser.tabs.create({ url, active: true });
  },
};
