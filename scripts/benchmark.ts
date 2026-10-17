import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { createService } from '../src/application/service';
import type { Tabs } from '../src/application/ports';
import {
  DEFAULT_SETTINGS,
  DAY,
  MINUTE,
  type TabSnapshot,
} from '../src/domain/model';
import { createStore, type StorageArea } from '../src/platform/storage';
import {
  createWorkerProfiler,
  type TaskProfile,
} from '../src/platform/profiling';

// In-memory adapters. They capture serialization cost, not browser IPC, disk, or startup.
class MemoryStorage implements StorageArea {
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

const ITERATIONS = 30;
const report = [];
const workloads: [number, number][] = [
  [25, 0],
  [100, 1000],
  [500, 5000],
];
for (const [tabCount, archiveCount] of workloads) {
  for (const task of ['cleanup', 'activity', 'initialize + cleanup'] as const) {
    let now = Date.UTC(2026, 9, 9, 12);
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.values = {
      meta: { version: 2 },
      settings: DEFAULT_SETTINGS,
      statistics: { lifetimeArchivedTabs: archiveCount },
    };
    for (let i = 0; i < archiveCount; i++) {
      const id = crypto.randomUUID();
      local.values[`archive:${id}`] = {
        id,
        title: `Sample archived page ${i}`,
        url: `https://example.test/archive/${i}`,
        lastUsedAt: now - 20 * DAY,
        archivedAt: now - 10 * DAY,
        outcome: 'closed',
        operationKey: `sample:${i}`,
      };
    }
    const live: TabSnapshot[] = Array.from({ length: tabCount }, (_, i) => ({
      id: i + 1,
      windowId: 1,
      url: `https://example.test/open/${i}`,
      title: `Sample open page ${i}`,
      lastAccessed: now - DAY,
      active: i === 0,
      pinned: false,
      highlighted: false,
      audible: false,
      incognito: false,
      loading: false,
      normalWindow: true,
    }));
    const tabs: Tabs = {
      list: async () => structuredClone(live),
      get: async (id) => structuredClone(live.find((tab) => tab.id === id)),
      close: async () => {
        throw new Error('Benchmark fixtures must not be eligible.');
      },
      open: async () => {
        throw new Error('Benchmark must not open tabs.');
      },
    };
    const samples: TaskProfile[] = [];
    const profiler = createWorkerProfiler({
      emit: (sample) => samples.push(sample),
    });
    const store = createStore(
      profiler.trackStorage(local, 'local'),
      profiler.trackStorage(session, 'session'),
    );
    const deps = {
      tabs: profiler.trackTabs(tabs),
      store,
      now: () => now,
      uuid: () => crypto.randomUUID(),
    };
    const service = createService(deps);
    await service.initialize();
    const state = (await store.session())!;
    state.graceUntil = now;
    await store.saveSession(state);
    async function work() {
      now += MINUTE;
      if (task === 'cleanup') await service.cleanup();
      else if (task === 'activity') await service.activity();
      else {
        const fresh = createService(deps);
        await fresh.initialize();
        await fresh.cleanup();
      }
    }
    // Warm up the host engine before recording. This is not a browser cold-start test.
    for (let i = 0; i < 5; i++) await work();
    const cpu = process.cpuUsage();
    for (let i = 0; i < ITERATIONS; i++) await profiler.measure(task, work);
    const usedCpu = process.cpuUsage(cpu);
    const times = samples.map((sample) => sample.wallMs).sort((a, b) => a - b);
    const first = samples[0]!;
    report.push({
      tabs: tabCount,
      archived: archiveCount,
      task,
      iterations: ITERATIONS,
      wallP50Ms: times[Math.ceil(ITERATIONS * 0.5) - 1],
      wallP95Ms: times[Math.ceil(ITERATIONS * 0.95) - 1],
      harnessCpuMsPerTask: (usedCpu.user + usedCpu.system) / 1000 / ITERATIONS,
      calls: first.calls,
      tabsScanned: first.tabsScanned,
      payloadBytes: first.payloadBytes,
    });
  }
}
const output = process.argv[2] ?? '.output/benchmark.json';
await mkdir('.output', { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      runtime: process.versions.bun
        ? `Bun ${process.versions.bun}`
        : `Node ${process.version}`,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      note: 'In-memory service benchmark. Includes profiling overhead; not Chromium wake-up CPU/RAM or battery usage.',
      results: report,
    },
    null,
    2,
  ) + '\n',
);
console.table(
  report.map((row) => ({
    tabs: row.tabs,
    archive: row.archived,
    task: row.task,
    'wall p50 ms': row.wallP50Ms!.toFixed(2),
    'wall p95 ms': row.wallP95Ms!.toFixed(2),
    'harness CPU ms/task': row.harnessCpuMsPerTask.toFixed(2),
    'local read KB/task': (row.payloadBytes.localRead / 1024).toFixed(1),
  })),
);
console.log(
  `In-memory benchmark only; not Chromium CPU/RAM. Full results: ${output}`,
);
