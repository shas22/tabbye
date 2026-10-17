import { describe, expect, it } from 'vitest';
import { commandSchema } from '../src/application/protocol';
import { createQueue } from '../src/application/queue';
import {
  archiveSchema,
  DEFAULT_SETTINGS,
  settingsSchema,
} from '../src/domain/model';
import { createStore, migrate } from '../src/platform/storage';
import { MemoryArea, NOW } from './helpers';

describe('storage boundaries', () => {
  it('initializes once without overwriting user settings', async () => {
    const local = new MemoryArea();
    await migrate(local);
    await local.set({ settings: { ...DEFAULT_SETTINGS, inactivityDays: 15 } });
    await migrate(local);
    expect(local.values.settings).toMatchObject({ inactivityDays: 15 });
  });
  it('refuses unsupported schema versions without modifying the data', async () => {
    const local = new MemoryArea();
    local.values = { meta: { version: 99 }, treasuredData: 'keep' };
    await expect(migrate(local)).rejects.toThrow();
    expect(local.values).toEqual({
      meta: { version: 99 },
      treasuredData: 'keep',
    });
  });
  it('does not silently erase malformed archives', async () => {
    const local = new MemoryArea();
    local.values['archive:bad'] = { url: 'secret' };
    await expect(
      createStore(local, new MemoryArea()).archives(),
    ).rejects.toThrow();
    expect(local.values['archive:bad']).toEqual({ url: 'secret' });
  });
  it('rejects executable links, unknown commands, invalid days, and malformed backups', () => {
    expect(
      archiveSchema.safeParse({
        id: crypto.randomUUID(),
        url: 'javascript:alert(1)',
        title: '',
        lastUsedAt: NOW,
        archivedAt: NOW,
        outcome: 'saved',
      }).success,
    ).toBe(false);
    expect(commandSchema.safeParse({ type: 'close', id: 1 }).success).toBe(
      false,
    );
    expect(
      commandSchema.safeParse({
        type: 'import',
        backup: { version: 99, entries: [] },
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...DEFAULT_SETTINGS, inactivityDays: 0 })
        .success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...DEFAULT_SETTINGS, inactivityDays: 1.5 })
        .success,
    ).toBe(false);
  });
  it('normalizes exclusions and rejects URLs masquerading as hostnames', () => {
    expect(
      settingsSchema.parse({
        ...DEFAULT_SETTINGS,
        excludedDomains: [' Example.COM. ', 'example.com'],
      }).excludedDomains,
    ).toEqual(['example.com']);
    expect(
      settingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        excludedDomains: ['https://example.com'],
      }).success,
    ).toBe(false);
  });
});

it('serializes overlapping work and continues after a rejected task', async () => {
  const enqueue = createQueue();
  const order: number[] = [];
  const first = enqueue(async () => {
    await Promise.resolve();
    order.push(1);
    throw new Error('first failed');
  });
  const handled = first.catch(() => undefined);
  const second = enqueue(async () => {
    order.push(2);
  });
  await Promise.all([handled, second]);
  expect(order).toEqual([1, 2]);
});
