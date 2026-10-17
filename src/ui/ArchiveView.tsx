import { useEffect, useRef } from 'react';
import type { ViewState } from '../domain/model';
import { groupByDay } from './archiveDates';
import { ArchiveRow, Button, EmptyState, Icon } from './components';

interface ArchiveViewProps {
  data?: ViewState;
  error?: string;
  query: string;
  now: number;
  compact: boolean;
  busy: boolean;
  onQuery: (query: string) => void;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ArchiveView({
  data,
  error,
  query,
  now,
  compact,
  busy,
  onQuery,
  onPage,
  onOpen,
  onDelete,
}: ArchiveViewProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (compact) input.current?.focus();
  }, [compact]);
  const groups = groupByDay(data?.entries ?? [], now);
  const searching = Boolean(query.trim());

  return (
    <section className="archive-view" aria-label="Archived links">
      <div className="search-toolbar">
        <div className="search-field">
          <Icon name="search" />
          <label className="sr-only" htmlFor="archive-search">
            Search archived links
          </label>
          <input
            ref={input}
            id="archive-search"
            type="search"
            placeholder="Search archived links…"
            value={query}
            maxLength={500}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onQuery('');
                event.stopPropagation();
              }
            }}
          />
        </div>
        {!compact && (
          <span className="search-summary">
            {searching ? `${data?.matching ?? 0} results` : 'Newest first'}
          </span>
        )}
      </div>
      <div className="archive-results">
        {!compact && groups.length > 0 && (
          <div className="column-labels" aria-hidden="true">
            <span>Page</span>
            <span>Website</span>
            <span>Last seen</span>
            <span>Saved</span>
            <span />
          </div>
        )}
        {data ? (
          groups.length ? (
            groups.map((group) => (
              <section
                className="day-group"
                key={group.key}
                aria-labelledby={`day-${group.key}`}
              >
                <h2 id={`day-${group.key}`}>{group.label}</h2>
                <ul className="archive-list">
                  {group.entries.map((entry) => (
                    <ArchiveRow
                      key={entry.id}
                      entry={entry}
                      compact={compact}
                      busy={busy}
                      onOpen={() => onOpen(entry.id)}
                      onDelete={() => onDelete(entry.id)}
                    />
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <EmptyState searching={searching} />
          )
        ) : (
          !error && (
            <p className="loading" role="status">
              Loading archive…
            </p>
          )
        )}
      </div>
      {data && data.matching > data.pageSize && (
        <nav className="pagination" aria-label="Archive pages">
          <Button
            disabled={data.page <= 1 || busy}
            onClick={() => onPage(data.page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {data.page} of {Math.ceil(data.matching / data.pageSize)}
          </span>
          <Button
            disabled={data.page * data.pageSize >= data.matching || busy}
            onClick={() => onPage(data.page + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </section>
  );
}
