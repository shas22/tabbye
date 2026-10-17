import { z } from '../domain/validation';
import {
  archiveSchema,
  DEFAULT_SETTINGS,
  lifetimeStatsSchema,
  sessionSchema,
  settingsSchema,
  type ArchivedLink,
} from '../domain/model';
import type { Store } from '../application/ports';

export interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const ARCHIVE_PREFIX = 'archive:';
const metaSchema = z
  .object({ version: z.union([z.literal(1), z.literal(2)]) })
  .strict();

function readArchive(key: string, value: unknown): ArchivedLink {
  const entry = archiveSchema.parse(value);
  if (key !== `${ARCHIVE_PREFIX}${entry.id}`)
    throw new Error('Archive identity does not match its storage key.');
  return entry;
}

function readArchives(values: Record<string, unknown>): ArchivedLink[] {
  return Object.entries(values)
    .filter(([key]) => key.startsWith(ARCHIVE_PREFIX))
    .map(([key, value]) => readArchive(key, value));
}

/** V2 adds a lifetime counter without changing archive records or the backup format. */
export async function migrate(local: StorageArea) {
  const values = await local.get(['meta', 'settings', 'statistics']);
  const meta =
    values.meta === undefined ? undefined : metaSchema.parse(values.meta);
  if (values.settings !== undefined) settingsSchema.parse(values.settings);
  if (meta?.version === 2) {
    // Never reset a missing or malformed lifetime counter to the current archive size.
    lifetimeStatsSchema.parse(values.statistics);
    if (values.settings === undefined)
      await local.set({ settings: DEFAULT_SETTINGS });
    return;
  }
  const statistics =
    values.statistics === undefined
      ? {
          lifetimeArchivedTabs: readArchives(await local.get(null)).filter(
            (entry) =>
              entry.outcome === 'closed' && Boolean(entry.operationKey),
          ).length,
        }
      : lifetimeStatsSchema.parse(values.statistics);
  await local.set({
    meta: { version: 2 },
    settings: values.settings ?? DEFAULT_SETTINGS,
    statistics,
  });
}

export function createStore(local: StorageArea, session: StorageArea): Store {
  return {
    initialize: () => migrate(local),
    async settings() {
      return settingsSchema.parse((await local.get('settings')).settings);
    },
    async saveSettings(settings) {
      await local.set({ settings: settingsSchema.parse(settings) });
    },
    async session() {
      const value = (await session.get('session')).session;
      return value === undefined ? undefined : sessionSchema.parse(value);
    },
    async saveSession(value) {
      await session.set({ session: sessionSchema.parse(value) });
    },
    async archives() {
      return readArchives(await local.get(null));
    },
    async saveArchives(entries: ArchivedLink[]) {
      if (!entries.length) return;
      const values = Object.fromEntries(
        entries.map((entry) => [
          `${ARCHIVE_PREFIX}${entry.id}`,
          archiveSchema.parse(entry),
        ]),
      );
      await local.set(values);
    },
    async statistics() {
      return lifetimeStatsSchema.parse(
        (await local.get('statistics')).statistics,
      );
    },
    async recordClosure(id) {
      const key = `${ARCHIVE_PREFIX}${z.uuid().parse(id)}`;
      const values = await local.get([key, 'statistics']);
      const entry = readArchive(key, values[key]);
      const statistics = lifetimeStatsSchema.parse(values.statistics);
      if (!entry.operationKey)
        throw new Error('Only automatic closures can be counted.');
      if (entry.outcome === 'closed') return;
      // The worker queue serializes this read/modify/write. Persist completion and
      // its count in one storage call so retrying a recorded closure is a no-op.
      await local.set({
        [key]: { ...entry, outcome: 'closed' },
        statistics: lifetimeStatsSchema.parse({
          lifetimeArchivedTabs: statistics.lifetimeArchivedTabs + 1,
        }),
      });
    },
    async deleteArchive(id) {
      await local.remove(`${ARCHIVE_PREFIX}${z.uuid().parse(id)}`);
    },
  };
}
