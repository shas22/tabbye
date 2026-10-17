import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { BACKUP_MAX_BYTES, backupSchema, type Settings } from '../domain/model';
import { openArchive, openSettings, request } from './client';
import { Button, Icon, Mark } from './components';
import { ArchiveView } from './ArchiveView';
import { LifetimeCount } from './LifetimeCount';
import { SettingsPanel } from './Settings';
import { useArchive } from './useArchive';

type Section = 'archive' | 'settings';

export function App({
  popup = false,
  initialSection,
}: {
  popup?: boolean;
  /** The options page starts on settings; the archive page reads its fragment. */
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(
    () =>
      initialSection ??
      (!popup && window.location.hash === '#settings' ? 'settings' : 'archive'),
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [now, setNow] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  const { data, error, reload } = useArchive(
    useDeferredValue(query),
    page,
    popup ? 6 : 20,
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function navigate(next: Section) {
    setSection(next);
    setNotice(undefined);
    window.history.replaceState(
      null,
      '',
      next === 'settings'
        ? '#settings'
        : window.location.pathname + window.location.search,
    );
  }

  async function action(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
      await reload();
      if (success) setNotice({ text: success });
    } catch (cause) {
      setNotice({
        text:
          cause instanceof Error
            ? cause.message
            : 'The action could not be completed.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const saveSettings = (settings: Partial<Settings>) =>
    action(() => request({ type: 'settings', settings }), 'Settings saved.');

  async function exportBackup() {
    await action(async () => {
      const backup = await request({ type: 'export' });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `tabbye-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'Backup downloaded.');
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await action(async () => {
      if (file.size > BACKUP_MAX_BYTES)
        throw new Error('Choose a Tabbye backup smaller than 12 MB.');
      let value: unknown;
      try {
        value = JSON.parse(await file.text());
      } catch {
        throw new Error('This file is not valid JSON.');
      }
      const parsed = backupSchema.safeParse(value);
      if (!parsed.success)
        throw new Error(
          'This file is not a supported Tabbye backup. No links were imported.',
        );
      const result = await request({ type: 'import', backup: parsed.data });
      setNotice({
        text: `${result.imported} ${result.imported === 1 ? 'link' : 'links'} imported. Existing links and settings were kept.`,
      });
    });
  }

  const waiting = Boolean(data?.settings.enabled && data.graceUntil > now);
  const status = !data
    ? 'Connecting…'
    : !data.settings.enabled
      ? 'Paused'
      : waiting
        ? `Cleanup starts in ${Math.max(1, Math.ceil((data.graceUntil - now) / 60_000))} min`
        : `After ${data.settings.inactivityDays} ${data.settings.inactivityDays === 1 ? 'day' : 'days'}`;
  const failure =
    error ?? (notice?.error ? notice.text : undefined) ?? data?.error;
  const message = failure ?? notice?.text;

  return (
    <div className={popup ? 'app popup' : 'app full-page'}>
      <header className="toolbar">
        <div className="toolbar-inner">
          <div className="brand-heading">
            <div className="page-heading">
              <span className="brand">
                <Mark />
                <span className="brand-name">
                  tabbye<span className="brand-dot">.</span>
                </span>
              </span>
              {popup ? (
                <h1 className="sr-only">Archived links</h1>
              ) : (
                <>
                  <span className="breadcrumb-divider" aria-hidden="true">
                    /
                  </span>
                  <h1>{section === 'settings' ? 'Settings' : 'Archive'}</h1>
                </>
              )}
              {!popup && section === 'archive' && data && (
                <span className="archive-count">{data.total} saved</span>
              )}
            </div>
            <p className="brand-tagline">Bye, tabs. Not your links.</p>
          </div>
          <nav aria-label="Main navigation">
            {section === 'settings' ? (
              <button
                className="text-button"
                onClick={() => navigate('archive')}
              >
                Archive
              </button>
            ) : (
              <button
                className="text-button nav-button"
                disabled={busy}
                onClick={() => {
                  if (popup) void action(openSettings);
                  else navigate('settings');
                }}
              >
                <Icon name="settings" />
                Settings
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="main-content">
        {section === 'archive' && data && (
          <LifetimeCount count={data.statistics.lifetimeArchivedTabs} />
        )}
        {message && (
          <div
            className={`notice ${failure ? 'error' : ''}`}
            role={failure ? 'alert' : 'status'}
          >
            {message}
            {error && (
              <button
                className="text-button"
                onClick={() => {
                  void reload();
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}
        {section === 'archive' ? (
          <ArchiveView
            data={data}
            error={error}
            query={query}
            now={now}
            compact={popup}
            busy={busy}
            onQuery={(value) => {
              setQuery(value);
              setPage(1);
            }}
            onPage={setPage}
            onOpen={(id) => {
              void action(
                () => request({ type: 'reopen', id }),
                'Link opened.',
              );
            }}
            onDelete={(id) => {
              void action(
                () => request({ type: 'delete', id }),
                'Link deleted.',
              );
            }}
          />
        ) : data ? (
          <div className="settings-content">
            <SettingsPanel
              // Reset the form only when a field it edits changes elsewhere;
              // pausing must not discard unsaved edits.
              key={`${data.settings.inactivityDays}|${data.settings.excludedDomains.join(',')}`}
              settings={data.settings}
              busy={busy}
              onSave={saveSettings}
            />
            <section
              className="backup-section"
              aria-labelledby="backup-heading"
            >
              <h2 id="backup-heading">Backup</h2>
              <p>
                Export your links and settings as a JSON file. Import adds links
                without changing your settings.
              </p>
              <div className="backup-actions">
                <Button
                  disabled={busy}
                  onClick={() => {
                    void exportBackup();
                  }}
                >
                  <Icon name="download" />
                  Export backup
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="upload" />
                  Import backup
                </Button>
              </div>
              <input
                className="sr-only"
                tabIndex={-1}
                aria-label="Import backup file"
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  void importBackup(event);
                }}
              />
              <p className="storage-note">
                Your archive is stored in this browser. Removing the extension
                deletes it.
              </p>
            </section>
          </div>
        ) : (
          !error && (
            <p className="loading" role="status">
              Loading settings…
            </p>
          )
        )}
      </main>
      <footer className="utility-footer">
        <div className="cleanup-controls" aria-label="Cleanup status">
          <span
            className={`status-dot ${data?.settings.enabled ? '' : 'paused'}`}
            aria-hidden="true"
          />
          <span>{status}</span>
          {waiting && (
            <button
              className="text-button"
              disabled={busy}
              title="Start cleanup now. Your inactivity limit and tab protections still apply."
              onClick={() => {
                void action(() => request({ type: 'skip-wait' }));
              }}
            >
              Skip wait
            </button>
          )}
          <span className="status-separator" aria-hidden="true">
            ·
          </span>
          <button
            className="text-button"
            disabled={!data || busy}
            onClick={() => {
              if (data)
                void action(() =>
                  request({
                    type: 'settings',
                    settings: { enabled: !data.settings.enabled },
                  }),
                );
            }}
          >
            {data?.settings.enabled ? 'Pause' : 'Resume'}
          </button>
        </div>
        {popup ? (
          <button
            className="text-button archive-link"
            disabled={busy}
            onClick={() => {
              void action(() => openArchive());
            }}
          >
            Open archive
            <Icon name="arrow" />
          </button>
        ) : (
          <span className="last-check">
            {data?.lastCleanupAt
              ? `Last checked ${new Date(data.lastCleanupAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
              : 'Active and pinned tabs are protected'}
          </span>
        )}
      </footer>
    </div>
  );
}
