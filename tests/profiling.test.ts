import { expect, it, vi } from 'vitest';
import {
  createWorkerProfiler,
  type TaskProfile,
} from '../src/platform/profiling';
import { fixture, MemoryArea } from './helpers';

it('measures task duration, operations, and UTF-8 payload size without recording browsing data', async () => {
  let time = 10;
  const samples: TaskProfile[] = [];
  const profiler = createWorkerProfiler({
    monotonic: () => time,
    timestamp: () => 100,
    emit: (sample) => samples.push(sample),
  });
  const storage = profiler.trackStorage(new MemoryArea(), 'local');
  const value = { privateKey: 'https://private.test/秘密' };
  await profiler.measure('cleanup', async () => {
    await storage.set(value);
    await storage.get('privateKey');
    time += 7;
    await storage.remove('privateKey');
  });
  expect(samples[0]).toMatchObject({
    firstTaskInWorker: true,
    task: 'cleanup',
    wallMs: 7,
    outcome: 'resolved',
    startedAt: 100,
    calls: { 'local.get': 1, 'local.set': 1, 'local.remove': 1 },
    payloadBytes: {
      localRead: new TextEncoder().encode(JSON.stringify(value)).length,
      localWrite: new TextEncoder().encode(JSON.stringify(value)).length,
    },
  });
  expect(JSON.stringify(samples)).not.toMatch(/privateKey|private\.test|秘密/);
  await profiler.measure('activity', async () => {
    time += 3;
  });
  expect(samples[1]).toMatchObject({
    firstTaskInWorker: false,
    workerId: samples[0]!.workerId,
    wallMs: 3,
    calls: {},
  });
});

it('counts tab operations without logging tab identities or URLs', async () => {
  const f = await fixture();
  const emit = vi.fn();
  const profiler = createWorkerProfiler({ emit });
  const tabs = profiler.trackTabs(f.tabs);
  await profiler.measure('cleanup', async () => {
    await tabs.list();
    await tabs.get(1);
    await tabs.close(1);
    await tabs.open('https://private.test');
  });
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      tabsScanned: 1,
      calls: { 'tabs.list': 1, 'tabs.get': 1, 'tabs.close': 1, 'tabs.open': 1 },
    }),
  );
  expect(JSON.stringify(emit.mock.calls)).not.toContain('https:');
});

it('preserves failures and resets measurements for the next task', async () => {
  const emit = vi.fn();
  const profiler = createWorkerProfiler({ emit });
  const error = new Error('Private details must not appear in diagnostics');
  await expect(
    profiler.measure('cleanup', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ outcome: 'rejected', firstTaskInWorker: true }),
  );
  expect(JSON.stringify(emit.mock.calls)).not.toContain('Private details');
  await profiler.measure('activity', async () => undefined);
  expect(emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ outcome: 'resolved', firstTaskInWorker: false }),
  );
});

it('does not fail browser work if the diagnostic sink fails', async () => {
  const profiler = createWorkerProfiler({
    emit: () => {
      throw new Error('Log unavailable');
    },
  });
  expect(await profiler.measure('view', async () => 42)).toBe(42);
});
