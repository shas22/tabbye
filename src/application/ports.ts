import type {
  ArchivedLink,
  LifetimeStats,
  SessionState,
  Settings,
  TabSnapshot,
} from '../domain/model';

export interface Tabs {
  list(): Promise<TabSnapshot[]>;
  get(id: number): Promise<TabSnapshot | undefined>;
  close(id: number): Promise<void>;
  open(url: string): Promise<void>;
}

export interface Store {
  initialize(): Promise<void>;
  settings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  session(): Promise<SessionState | undefined>;
  saveSession(session: SessionState): Promise<void>;
  archives(): Promise<ArchivedLink[]>;
  saveArchives(entries: ArchivedLink[]): Promise<void>;
  /** Called after a successful automatic close; retries must not count twice. */
  recordClosure(id: string): Promise<void>;
  statistics(): Promise<LifetimeStats>;
  deleteArchive(id: string): Promise<void>;
}

export interface Dependencies {
  tabs: Tabs;
  store: Store;
  now: () => number;
  uuid: () => string;
}
