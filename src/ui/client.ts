import { browser } from 'wxt/browser';
import {
  CHANGED_MESSAGE,
  type Command,
  type Reply,
  type Results,
} from '../application/protocol';

export async function request<C extends Command>(
  command: C,
): Promise<Results[C['type']]> {
  const reply = await browser.runtime.sendMessage<
    C,
    Reply<Results[C['type']]> | undefined
  >(command);
  if (!reply || !reply.ok)
    throw new Error(
      reply?.error ?? 'Tabbye is unavailable. Reload this page to reconnect.',
    );
  return reply.value;
}

export function subscribe(listener: () => void): () => void {
  const onMessage = (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === CHANGED_MESSAGE
    )
      listener();
  };
  browser.runtime.onMessage.addListener(onMessage);
  return () => browser.runtime.onMessage.removeListener(onMessage);
}

/** Focus an archive tab that is already open, or open a new one. */
export async function openArchive() {
  const url = browser.runtime.getURL('/archive.html');
  const contexts = await browser.runtime.getContexts({ contextTypes: ['TAB'] });
  const existing = contexts.find((context) =>
    context.documentUrl?.startsWith(url),
  );
  if (!existing) {
    await browser.tabs.create({ url });
    return;
  }
  // Send both calls before awaiting: the popup closes as soon as focus moves.
  await Promise.all([
    browser.tabs.update(existing.tabId, { active: true }),
    browser.windows.update(existing.windowId, { focused: true }),
  ]);
}

/** Chrome focuses an existing options tab instead of opening another. */
export async function openSettings() {
  await browser.runtime.openOptionsPage();
}
