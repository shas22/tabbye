import { describe, expect, it } from 'vitest';
import { eligible, observe } from '../src/domain/activity';
import { DAY, DEFAULT_SETTINGS, type TabSnapshot } from '../src/domain/model';
import { NOW, tab } from './helpers';

const token = crypto.randomUUID();
const observation = (value = tab()) => observe(value, undefined, NOW, token);

describe('archive eligibility', () => {
  it('expires exactly at the configured boundary', () => {
    const value = tab({ lastAccessed: NOW - 7 * DAY });
    expect(eligible(value, observation(value), DEFAULT_SETTINGS, NOW - 1)).toBe(
      false,
    );
    expect(eligible(value, observation(value), DEFAULT_SETTINGS, NOW)).toBe(
      true,
    );
  });
  it.each([
    'active',
    'highlighted',
    'pinned',
    'audible',
    'incognito',
    'loading',
  ] as const)('protects %s tabs', (flag) => {
    const value = tab({ [flag]: true });
    expect(eligible(value, observation(value), DEFAULT_SETTINGS, NOW)).toBe(
      false,
    );
  });
  it.each([
    'chrome://settings',
    'file:///work.txt',
    'javascript:alert(1)',
    'about:blank',
    '',
  ])('ignores unsupported URL %s', (url) => {
    const value = tab({ url });
    expect(eligible(value, observation(value), DEFAULT_SETTINGS, NOW)).toBe(
      false,
    );
  });
  it('honors pause, normal windows, and observed URL changes', () => {
    expect(
      eligible(
        tab(),
        observation(),
        { ...DEFAULT_SETTINGS, enabled: false },
        NOW,
      ),
    ).toBe(false);
    expect(
      eligible(
        tab({ normalWindow: false }),
        observation(),
        DEFAULT_SETTINGS,
        NOW,
      ),
    ).toBe(false);
    expect(
      eligible(
        tab({ url: 'https://elsewhere.test' }),
        observation(),
        DEFAULT_SETTINGS,
        NOW,
      ),
    ).toBe(false);
  });
  it.each([
    ['https://example.com/', false],
    ['https://docs.example.com/a', false],
    ['https://notexample.com', true],
    ['https://example.com.evil.test', true],
  ])('matches hostname boundaries for %s', (url, expected) => {
    const value = tab({ url });
    expect(
      eligible(
        value,
        observation(value),
        { ...DEFAULT_SETTINGS, excludedDomains: ['example.com'] },
        NOW,
      ),
    ).toBe(expected);
  });
});

describe('activity observations', () => {
  it('keeps existing age at installation', () =>
    expect(observation().lastUsedAt).toBe(NOW - 10 * DAY));
  it.each([undefined, NaN, Infinity, 0, NOW + DAY])(
    'starts fresh with invalid or missing native time %s',
    (lastAccessed) => {
      expect(observation(tab({ lastAccessed })).lastUsedAt).toBe(NOW);
    },
  );
  it('records leaving a tab even if it was selected for many days', () => {
    const prior = observation(tab({ active: true }));
    expect(observe(tab(), prior, NOW + 20 * DAY, token).lastUsedAt).toBe(
      NOW + 20 * DAY,
    );
  });
  it('does not count background navigation as interaction', () => {
    const old = observation();
    const next = observe(
      tab({ url: 'https://example.com/refreshed' }),
      old,
      NOW,
      crypto.randomUUID(),
    );
    expect(next.lastUsedAt).toBe(old.lastUsedAt);
    expect(next.token).not.toBe(old.token);
  });
  it('uses more recent native activity when events have not been processed yet', () => {
    expect(
      observe(tab({ lastAccessed: NOW }), observation(), NOW, token).lastUsedAt,
    ).toBe(NOW);
  });
  it('uses a prior observation when the browser omits its timestamp', () => {
    const value: TabSnapshot = tab({ lastAccessed: undefined });
    expect(observe(value, observation(), NOW, token).lastUsedAt).toBe(
      NOW - 10 * DAY,
    );
  });
});
