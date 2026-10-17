import type { ArchivedLink } from '../domain/model';

export interface ArchiveDay {
  key: string;
  label: string;
  entries: ArchivedLink[];
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Group the current page by local calendar date, including across DST changes. */
export function groupByDay(entries: ArchivedLink[], now: number): ArchiveDay[] {
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, ArchiveDay>();

  for (const entry of entries) {
    const date = new Date(entry.archivedAt);
    const key = localDay(date);
    let group = groups.get(key);
    if (!group) {
      const label =
        key === localDay(today)
          ? 'Today'
          : key === localDay(yesterday)
            ? 'Yesterday'
            : date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                ...(date.getFullYear() === today.getFullYear()
                  ? {}
                  : { year: 'numeric' as const }),
              });
      group = { key, label, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}
