import { z } from './validation';

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
export const GRACE = 5 * MINUTE;
export const GAP = 2 * MINUTE;
// A compact export of the 10 MB local store must fit back through the importer.
export const BACKUP_MAX_BYTES = 12 * 1024 * 1024;

// Chromium lastAccessed is a double: fractional milliseconds are valid.
const timestamp = z.number().nonnegative().max(8_640_000_000_000_000);
export const webUrl = z
  .url({
    protocol: /^https?$/,
    error: 'Only HTTP and HTTPS links are supported.',
  })
  .max(8192);

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    inactivityDays: z.number().int().min(1).max(365),
    excludedDomains: z
      .array(
        z
          .string()
          .transform(normalizeDomain)
          .pipe(
            z
              .string()
              .min(1)
              .max(253)
              .regex(
                /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
                'Enter a hostname, such as example.com.',
              ),
          ),
      )
      .max(200)
      .transform((domains) => [...new Set(domains)]),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  inactivityDays: 7,
  excludedDomains: [],
};

export const archiveSchema = z
  .object({
    id: z.uuid(),
    url: webUrl,
    title: z.string().max(2000),
    lastUsedAt: timestamp,
    archivedAt: timestamp,
    outcome: z.enum(['saved', 'closed']),
    operationKey: z.string().max(512).optional(),
  })
  .strict();
export type ArchivedLink = z.infer<typeof archiveSchema>;

export const lifetimeStatsSchema = z
  .object({ lifetimeArchivedTabs: z.number().int().nonnegative() })
  .strict();
export type LifetimeStats = z.infer<typeof lifetimeStatsSchema>;

export const backupSchema = z
  .object({
    // Exports use 'tabbye'. 'autotabs' is the pre-rename name, accepted so
    // older backup files can still be imported.
    format: z.enum(['tabbye', 'autotabs']),
    version: z.literal(1),
    exportedAt: timestamp,
    settings: settingsSchema,
    entries: z.array(archiveSchema).max(50_000),
  })
  .strict();
export type Backup = z.infer<typeof backupSchema>;

export interface TabSnapshot {
  id: number;
  windowId: number;
  url: string;
  title: string;
  lastAccessed?: number;
  active: boolean;
  pinned: boolean;
  highlighted: boolean;
  audible: boolean;
  incognito: boolean;
  loading: boolean;
  normalWindow: boolean;
}

export const observationSchema = z.object({
  token: z.uuid(),
  url: z.string(),
  lastUsedAt: timestamp,
  wasActive: z.boolean(),
});
export type Observation = z.infer<typeof observationSchema>;

export const sessionSchema = z.object({
  id: z.uuid(),
  lastCheckAt: timestamp,
  graceUntil: timestamp,
  observations: z.record(z.string(), observationSchema),
  lastCleanupAt: timestamp.nullable(),
  lastCleanupCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type SessionState = z.infer<typeof sessionSchema>;

export interface ViewState {
  settings: Settings;
  statistics: LifetimeStats;
  entries: ArchivedLink[];
  total: number;
  matching: number;
  page: number;
  pageSize: number;
  graceUntil: number;
  lastCleanupAt: number | null;
  lastCleanupCount: number;
  error: string | null;
}
