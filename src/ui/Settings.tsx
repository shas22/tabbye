import { useState, type SubmitEvent } from 'react';
import { settingsSchema, type Settings } from '../domain/model';
import { Icon } from './components';

export function SettingsPanel({
  settings,
  busy,
  onSave,
}: {
  settings: Settings;
  busy: boolean;
  onSave: (
    settings: Pick<Settings, 'inactivityDays' | 'excludedDomains'>,
  ) => Promise<void>;
}) {
  const [days, setDays] = useState(String(settings.inactivityDays));
  const [domains, setDomains] = useState(settings.excludedDomains.join('\n'));
  const [error, setError] = useState<string>();
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = settingsSchema.safeParse({
      ...settings,
      inactivityDays: Number(days),
      excludedDomains: domains
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your settings.');
      return;
    }
    setError(undefined);
    await onSave({
      inactivityDays: parsed.data.inactivityDays,
      excludedDomains: parsed.data.excludedDomains,
    });
  }
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <section className="settings-section">
        <div>
          <h2>Automatic cleanup</h2>
          <p>
            Close and save tabs after this many days without a visit. Time
            asleep counts.
          </p>
        </div>
        <div>
          <label className="days-label" htmlFor="inactivity-days">
            Archive after
          </label>
          <div className="number-field">
            <input
              id="inactivity-days"
              type="number"
              min="1"
              max="365"
              required
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
            <span>days</span>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>Website exclusions</h2>
          <p>Keep tabs from these domains open, including their subdomains.</p>
        </div>
        <div className="domain-field">
          <label htmlFor="excluded-domains">Excluded websites</label>
          <textarea
            id="excluded-domains"
            rows={5}
            placeholder={'example.com\nwork.example.org'}
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            aria-describedby="domain-help"
          />
          <small id="domain-help">
            One hostname per line. Leave out https:// and page paths.
          </small>
        </div>
      </section>
      <aside className="protection-note">
        <Icon name="shield" />
        <div>
          <strong>Protected tabs</strong>
          <p>
            Active, selected, pinned, loading, and audio-playing tabs are
            protected. Cleanup waits five minutes after startup or a long break.
            Use Skip wait to start sooner. Pin tabs with unfinished work.
          </p>
        </div>
      </aside>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="form-footer">
        <p>Reopening a link keeps it in your archive.</p>
        <button className="button primary" type="submit" disabled={busy}>
          Save settings
        </button>
      </div>
    </form>
  );
}
