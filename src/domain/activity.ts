import {
  DAY,
  type Observation,
  type Settings,
  type TabSnapshot,
  webUrl,
} from './model';

function validTime(time: number | undefined, now: number): time is number {
  return time !== undefined && Number.isFinite(time) && time > 0 && time <= now;
}

/** Browser timestamps bootstrap each session; local observations record leaving a tab too. */
export function observe(
  tab: TabSnapshot,
  previous: Observation | undefined,
  now: number,
  token: string,
): Observation {
  const nativeTime = validTime(tab.lastAccessed, now)
    ? tab.lastAccessed
    : undefined;
  const priorTime =
    previous && validTime(previous.lastUsedAt, now)
      ? previous.lastUsedAt
      : undefined;
  const lastUsedAt =
    tab.active || previous?.wasActive
      ? now
      : Math.max(nativeTime ?? priorTime ?? now, priorTime ?? 0);
  return {
    token: previous?.url === tab.url ? previous.token : token,
    url: tab.url,
    lastUsedAt,
    wasActive: tab.active,
  };
}

export function isExcluded(url: string, domains: string[]): boolean {
  const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

export function eligible(
  tab: TabSnapshot,
  observation: Observation,
  settings: Settings,
  now: number,
): boolean {
  if (
    !settings.enabled ||
    !tab.normalWindow ||
    tab.incognito ||
    tab.active ||
    tab.highlighted ||
    tab.pinned ||
    tab.audible ||
    tab.loading
  )
    return false;
  if (tab.url !== observation.url || !webUrl.safeParse(tab.url).success)
    return false;
  if (isExcluded(tab.url, settings.excludedDomains)) return false;
  return now - observation.lastUsedAt >= settings.inactivityDays * DAY;
}
