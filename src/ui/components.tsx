import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ArchivedLink } from '../domain/model';

export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M7 10h18v15H7z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M11 6h10M12 16h8M16 12v8m-3-3 3 3 3-3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Icon({
  name,
}: {
  name:
    | 'arrow'
    | 'search'
    | 'archive'
    | 'settings'
    | 'shield'
    | 'trash'
    | 'download'
    | 'upload';
}) {
  const paths = {
    arrow: 'M7 17 17 7M7 7h10v10',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    archive: 'M4 8h16v13H4zM3 3h18v5H3zM9 12h6',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6',
    trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={primary ? 'button primary' : 'button'}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function ArchiveRow({
  entry,
  busy,
  onOpen,
  onDelete,
  compact,
}: {
  entry: ArchivedLink;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmation = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmation.current?.focus();
  }, [confirming]);
  const hostname = new URL(entry.url).hostname;
  const lastSeen = new Date(entry.lastUsedAt);
  const saved = new Date(entry.archivedAt);
  return (
    <li
      className={`archive-row ${compact ? 'compact' : ''} ${confirming ? 'confirming' : ''}`}
    >
      <div className="entry-copy">
        <button
          ref={title}
          className="entry-title"
          title={entry.title}
          onClick={onOpen}
          disabled={busy}
        >
          {entry.title}
        </button>
      </div>
      <span className="entry-host" title={entry.url}>
        {hostname}
      </span>
      {!compact && (
        <div className="entry-last-seen">
          <span className="entry-date-label" aria-hidden="true">
            Last seen
          </span>
          <time
            dateTime={lastSeen.toISOString()}
            title={lastSeen.toLocaleString()}
          >
            <span className="sr-only">Last seen: </span>
            <span>
              {lastSeen.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <span className="entry-last-seen-clock">
              {lastSeen.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </time>
        </div>
      )}
      <time
        className="entry-time"
        dateTime={saved.toISOString()}
        title={saved.toLocaleString()}
      >
        <span className="sr-only">Saved: </span>
        {saved.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </time>
      <div className={`entry-actions ${confirming ? 'confirm-actions' : ''}`}>
        {confirming ? (
          <>
            <button
              ref={confirmation}
              className="button danger"
              disabled={busy}
              onClick={() => {
                onDelete();
                setConfirming(false);
              }}
            >
              Confirm delete
            </button>
            <button
              className="text-button"
              onClick={() => {
                setConfirming(false);
                title.current?.focus();
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className="icon-button"
              aria-label={`Reopen ${entry.title}`}
              title="Open link"
              onClick={onOpen}
              disabled={busy}
            >
              <Icon name="arrow" />
            </button>
            {!compact && (
              <button
                className="icon-button delete-button"
                disabled={busy}
                aria-label={`Delete ${entry.title}`}
                title="Delete link"
                onClick={() => setConfirming(true)}
              >
                <Icon name="trash" />
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="empty-state">
      <h2>{searching ? 'No matching links' : 'No archived tabs yet'}</h2>
      <p>
        {searching
          ? 'Try a different title or website.'
          : 'Links from automatically closed tabs appear here.'}
      </p>
    </div>
  );
}
