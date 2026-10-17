import { expect, it } from 'vitest';
import type { ArchivedLink } from '../src/domain/model';
import { groupByDay } from '../src/ui/archiveDates';

function entry(date: Date): ArchivedLink {
  return {
    id: crypto.randomUUID(),
    url: 'https://example.com',
    title: 'Saved link',
    archivedAt: date.getTime(),
    lastUsedAt: date.getTime(),
    outcome: 'closed',
  };
}

it('groups by local calendar day while preserving entry order', () => {
  const entries = [
    entry(new Date(2026, 9, 8, 12)),
    entry(new Date(2026, 9, 8, 0)),
    entry(new Date(2026, 9, 7, 23, 59)),
    entry(new Date(2026, 9, 6, 12)),
  ];
  const groups = groupByDay(entries, new Date(2026, 9, 8, 14).getTime());
  expect(groups.map((group) => group.key)).toEqual([
    '2026-10-8',
    '2026-10-7',
    '2026-10-6',
  ]);
  expect(groups[0]).toMatchObject({
    label: 'Today',
    entries: entries.slice(0, 2),
  });
  expect(groups[1]).toMatchObject({
    label: 'Yesterday',
    entries: [entries[2]],
  });
  expect(groups[2]?.label).not.toMatch(/Today|Yesterday/);
});

it('recognizes yesterday across a year boundary and labels older years', () => {
  const groups = groupByDay(
    [entry(new Date(2025, 11, 31, 23, 59)), entry(new Date(2025, 11, 30, 12))],
    new Date(2026, 0, 1, 0, 1).getTime(),
  );
  expect(groups[0]?.label).toBe('Yesterday');
  expect(groups[1]?.label).toContain('2025');
});

// Run these under TZ=America/New_York as well to cover 23- and 25-hour days.
it.each([
  [2, 9],
  [10, 2],
])('keeps yesterday tied to the calendar around DST (%s/%s)', (month, day) => {
  const now = new Date(2026, month, day, 0, 30);
  const groups = groupByDay(
    [
      entry(new Date(2026, month, day, 0, 15)),
      entry(new Date(2026, month, day - 1, 0, 15)),
      entry(new Date(2026, month, day - 2, 23, 45)),
    ],
    now.getTime(),
  );
  expect(groups[0]?.label).toBe('Today');
  expect(groups[1]?.label).toBe('Yesterday');
  expect(groups[2]?.label).not.toMatch(/Today|Yesterday/);
});

it('returns no groups for an empty page', () => {
  expect(groupByDay([], Date.now())).toEqual([]);
});
