import { vi } from 'vitest';
import { DAY, type TabSnapshot } from '../src/domain/model';
import { createStore, type StorageArea } from '../src/platform/storage';
import { createService } from '../src/application/service';

export const NOW = Date.UTC(2026, 9, 8, 12);

export class MemoryArea implements StorageArea {
  values: Record<string, unknown> = {};
  async get(keys?: string | string[] | null) {
    return structuredClone(
      keys == null
        ? this.values
        : Object.fromEntries(
            (typeof keys === 'string' ? [keys] : keys)
              .filter((key) => key in this.values)
              .map((key) => [key, this.values[key]]),
          ),
    );
  }
  async set(values: Record<string, unknown>) {
    Object.assign(this.values, structuredClone(values));
  }
  async remove(key: string) {
    delete this.values[key];
  }
}

export function tab(overrides: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    id: 1,
    windowId: 1,
    url: 'https://example.com/article',
    title: 'A useful article',
    lastAccessed: NOW - 10 * DAY,
    active: false,
    highlighted: false,
    pinned: false,
    audible: false,
    incognito: false,
    loading: false,
    normalWindow: true,
    ...overrides,
  };
}

export async function fixture(initialTabs = [tab()]) {
  const local = new MemoryArea();
  const sessionArea = new MemoryArea();
  const store = createStore(local, sessionArea);
  let time = NOW;
  const live = new Map(initialTabs.map((value) => [value.id, value]));
  const tabs = {
    list: vi.fn(async () => structuredClone([...live.values()])),
    get: vi.fn(async (id: number) => structuredClone(live.get(id))),
    close: vi.fn(async (id: number) => {
      live.delete(id);
    }),
    open: vi.fn<(url: string) => Promise<void>>(async () => undefined),
  };
  const dependencies = {
    tabs,
    store,
    now: () => time,
    uuid: () => crypto.randomUUID(),
  };
  const service = createService(dependencies);
  await service.initialize();
  return {
    local,
    sessionArea,
    store,
    live,
    tabs,
    service,
    dependencies,
    advance: (ms: number) => {
      time += ms;
    },
    async endGrace() {
      const state = (await store.session())!;
      state.graceUntil = time;
      await store.saveSession(state);
    },
  };
}
