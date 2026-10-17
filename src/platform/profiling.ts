import type { Tabs } from '../application/ports';
import type { StorageArea } from './storage';

export interface TaskProfile {
  workerId: string;
  task: string;
  firstTaskInWorker: boolean;
  startedAt: number;
  wallMs: number;
  outcome: 'resolved' | 'rejected';
  calls: Record<string, number>;
  tabsScanned: number;
  payloadBytes: {
    localRead: number;
    localWrite: number;
    sessionRead: number;
    sessionWrite: number;
  };
}

/** Developer-only, serialized task measurements. Never records URLs, keys, or values. */
export function createWorkerProfiler({
  monotonic = () => performance.now(),
  timestamp = () => Date.now(),
  emit,
}: {
  monotonic?: () => number;
  timestamp?: () => number;
  emit: (profile: TaskProfile) => void;
}) {
  const workerId = crypto.randomUUID();
  const encoder = new TextEncoder();
  let firstTaskInWorker = true;
  let current: TaskProfile | undefined;
  function call(name: string) {
    if (current) current.calls[name] = (current.calls[name] ?? 0) + 1;
  }
  function bytes(value: unknown) {
    return encoder.encode(JSON.stringify(value) ?? '').byteLength;
  }

  async function measure<T>(task: string, work: () => Promise<T>): Promise<T> {
    const profile: TaskProfile = {
      workerId,
      task,
      firstTaskInWorker,
      startedAt: timestamp(),
      wallMs: 0,
      outcome: 'resolved',
      calls: {},
      tabsScanned: 0,
      payloadBytes: {
        localRead: 0,
        localWrite: 0,
        sessionRead: 0,
        sessionWrite: 0,
      },
    };
    firstTaskInWorker = false;
    current = profile;
    const start = monotonic();
    try {
      return await work();
    } catch (error) {
      profile.outcome = 'rejected';
      throw error;
    } finally {
      profile.wallMs = Math.max(0, monotonic() - start);
      current = undefined;
      try {
        emit(profile);
      } catch {
        /* Diagnostics must not interrupt browser work. */
      }
    }
  }

  function trackStorage(
    area: StorageArea,
    scope: 'local' | 'session',
  ): StorageArea {
    return {
      async get(keys) {
        call(`${scope}.get`);
        const values = await area.get(keys);
        if (current) current.payloadBytes[`${scope}Read`] += bytes(values);
        return values;
      },
      async set(values) {
        call(`${scope}.set`);
        if (current) current.payloadBytes[`${scope}Write`] += bytes(values);
        await area.set(values);
      },
      async remove(key) {
        call(`${scope}.remove`);
        await area.remove(key);
      },
    };
  }

  function trackTabs(tabs: Tabs): Tabs {
    return {
      async list() {
        call('tabs.list');
        const values = await tabs.list();
        if (current) current.tabsScanned += values.length;
        return values;
      },
      async get(id) {
        call('tabs.get');
        return tabs.get(id);
      },
      async close(id) {
        call('tabs.close');
        await tabs.close(id);
      },
      async open(url) {
        call('tabs.open');
        await tabs.open(url);
      },
    };
  }
  return { measure, trackStorage, trackTabs };
}
