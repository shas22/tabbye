import { eligible, observe } from '../domain/activity';
import {
  GAP,
  GRACE,
  type ArchivedLink,
  type SessionState,
  type ViewState,
} from '../domain/model';
import type { Dependencies } from './ports';
import type { Command, Results } from './protocol';

type CommandOf<K extends Command['type']> = Extract<Command, { type: K }>;
type Handlers = {
  [K in Command['type']]: (command: CommandOf<K>) => Promise<Results[K]>;
};

/** One instance per worker. The entrypoint serializes commands and events through a queue. */
export function createService({ tabs, store, now, uuid }: Dependencies) {
  async function session(): Promise<SessionState> {
    return (
      (await store.session()) ?? {
        id: uuid(),
        lastCheckAt: now(),
        graceUntil: now() + GRACE,
        observations: {},
        lastCleanupAt: null,
        lastCleanupCount: 0,
        error: null,
      }
    );
  }

  async function reconcile(state: SessionState) {
    const live = await tabs.list();
    const observations: SessionState['observations'] = {};
    for (const tab of live) {
      observations[tab.id] = observe(
        tab,
        state.observations[tab.id],
        now(),
        uuid(),
      );
    }
    state.observations = observations;
    return live;
  }

  async function initialize(startup = false) {
    await store.initialize();
    const state = await session();
    if (startup) {
      // startup creates a new namespace even if the browser retained unexpected session data.
      state.id = uuid();
      state.observations = {};
      state.graceUntil = now() + GRACE;
      state.lastCheckAt = now();
    }
    await reconcile(state);
    await store.saveSession(state);
  }

  async function activity() {
    const state = await session();
    await reconcile(state);
    await store.saveSession(state);
  }

  async function cleanup({ skipWait = false }: { skipWait?: boolean } = {}) {
    const state = await session();
    const checkTime = now();
    if (skipWait) {
      // A stale or repeated request must not resume paused cleanup or start
      // another batch after the waiting period has already ended.
      if (state.graceUntil <= checkTime || !(await store.settings()).enabled)
        return;
      state.graceUntil = checkTime;
    } else if (
      checkTime - state.lastCheckAt > GAP ||
      checkTime < state.lastCheckAt
    ) {
      state.graceUntil = checkTime + GRACE;
    }
    state.lastCheckAt = checkTime;
    state.error = null;
    state.lastCleanupCount = 0;
    try {
      const live = await reconcile(state);
      // Persist observations and the heartbeat before performing any destructive operation.
      await store.saveSession(state);
      if (checkTime < state.graceUntil) return;
      const settings = await store.settings();
      if (!settings.enabled) return;
      // Most checks have no expired tabs. Load retry records only when a
      // candidate exists, so idle checks do not scan a growing archive.
      let byOperation: Map<string | undefined, ArchivedLink> | undefined;
      // Bound each run; later alarms handle the rest without a long-lived worker.
      let attempted = 0;
      for (const tab of live) {
        const observation = state.observations[tab.id];
        if (!observation || !eligible(tab, observation, settings, now()))
          continue;
        if (attempted++ >= 25) break;
        byOperation ??= new Map(
          (await store.archives())
            .filter((entry) => entry.operationKey)
            .map((entry) => [entry.operationKey, entry]),
        );
        const operationKey = `${state.id}:${observation.token}:${observation.lastUsedAt}`;
        const entry: ArchivedLink = byOperation.get(operationKey) ?? {
          id: uuid(),
          operationKey,
          url: tab.url,
          title: (tab.title || tab.url).slice(0, 2000),
          lastUsedAt: observation.lastUsedAt,
          archivedAt: now(),
          outcome: 'saved',
        };
        await store.saveArchives([entry]);
        const freshSettings = await store.settings();
        const fresh = await tabs.get(tab.id);
        if (!fresh || fresh.url !== tab.url) continue;
        const freshObservation = observe(
          fresh,
          observation,
          now(),
          observation.token,
        );
        if (
          freshObservation.lastUsedAt !== observation.lastUsedAt ||
          !eligible(fresh, freshObservation, freshSettings, now())
        )
          continue;
        try {
          await tabs.close(tab.id);
        } catch {
          state.error =
            'A link was saved, but its tab could not be closed. Tabbye will try again on a later check.';
          continue;
        }
        // A crash here leaves the link saved but uncounted; the tab is already gone.
        delete state.observations[tab.id];
        state.lastCleanupCount += 1;
        await store.recordClosure(entry.id);
      }
      state.lastCleanupAt = checkTime;
    } catch {
      state.error =
        'Cleanup stopped because browser data could not be read or saved. Check available storage, export your archive, or reload the extension.';
    } finally {
      await store.saveSession(state);
    }
  }

  async function view(command: CommandOf<'view'>): Promise<ViewState> {
    const [settings, entries, state, statistics] = await Promise.all([
      store.settings(),
      store.archives(),
      session(),
      store.statistics(),
    ]);
    const query = command.query.trim().toLowerCase();
    const filtered = entries
      .filter((entry) =>
        `${entry.title}\n${entry.url}`.toLowerCase().includes(query),
      )
      .sort((a, b) => b.archivedAt - a.archivedAt || a.id.localeCompare(b.id));
    const page = Math.min(
      command.page,
      Math.max(1, Math.ceil(filtered.length / command.pageSize)),
    );
    return {
      settings,
      statistics,
      entries: filtered.slice(
        (page - 1) * command.pageSize,
        page * command.pageSize,
      ),
      total: entries.length,
      matching: filtered.length,
      page,
      pageSize: command.pageSize,
      graceUntil: state.graceUntil,
      lastCleanupAt: state.lastCleanupAt,
      lastCleanupCount: state.lastCleanupCount,
      error: state.error,
    };
  }

  async function importBackup({ backup }: CommandOf<'import'>) {
    const existing = new Set((await store.archives()).map((entry) => entry.id));
    const imported: ArchivedLink[] = [];
    for (const source of backup.entries) {
      const entry = { ...source };
      delete entry.operationKey;
      if (existing.has(entry.id)) continue;
      existing.add(entry.id);
      imported.push(entry);
    }
    await store.saveArchives(imported);
    return { imported: imported.length };
  }

  const handlers: Handlers = {
    view,
    async settings({ settings }) {
      await store.saveSettings({ ...(await store.settings()), ...settings });
      return null;
    },
    async reopen({ id }) {
      const entry = (await store.archives()).find((item) => item.id === id);
      if (!entry) throw new Error('That saved link no longer exists.');
      await tabs.open(entry.url);
      return null;
    },
    async delete({ id }) {
      await store.deleteArchive(id);
      return null;
    },
    async 'skip-wait'() {
      await cleanup({ skipWait: true });
      return null;
    },
    async export() {
      return {
        format: 'tabbye',
        version: 1,
        exportedAt: now(),
        settings: await store.settings(),
        entries: await store.archives(),
      };
    },
    import: importBackup,
  };

  function handle<C extends Command>(command: C): Promise<Results[C['type']]> {
    // TypeScript can't link `command.type` to the handler's parameter type here.
    const handler = handlers[command.type] as (
      command: C,
    ) => Promise<Results[C['type']]>;
    return handler(command);
  }

  return { initialize, activity, cleanup, handle };
}
