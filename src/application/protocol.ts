import { z } from '../domain/validation';
import {
  backupSchema,
  settingsSchema,
  type Backup,
  type ViewState,
} from '../domain/model';

export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('view'),
      query: z.string().max(500),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal('settings'),
      settings: settingsSchema
        .partial()
        .refine((patch) => Object.keys(patch).length > 0),
    })
    .strict(),
  z.object({ type: z.literal('reopen'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('delete'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('skip-wait') }).strict(),
  z.object({ type: z.literal('export') }).strict(),
  z.object({ type: z.literal('import'), backup: backupSchema }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export interface Results {
  view: ViewState;
  settings: null;
  reopen: null;
  delete: null;
  'skip-wait': null;
  export: Backup;
  import: { imported: number };
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

/** Sent by the worker after a change that open extension pages display. Contains no tab data. */
export const CHANGED_MESSAGE = 'tabbye:changed';
