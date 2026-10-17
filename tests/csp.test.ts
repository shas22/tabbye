import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('creates and uses extension schemas without attempting dynamic code evaluation', async () => {
  vi.resetModules();
  const attempts = vi.fn(() => {
    throw new EvalError(
      'Extension content security policy forbids string evaluation.',
    );
  });
  // A caught Function() probe still reports a CSP violation in Chrome. Count
  // attempts, rather than merely asserting that schema parsing does not throw.
  vi.stubGlobal(
    'Function',
    new Proxy(Function, {
      apply: attempts,
      construct: attempts,
    }),
  );

  const { commandSchema } = await import('../src/application/protocol');
  const { sessionSchema } = await import('../src/domain/model');
  expect(
    commandSchema.safeParse({
      type: 'settings',
      settings: { inactivityDays: 14 },
    }).success,
  ).toBe(true);
  expect(
    commandSchema.safeParse({
      type: 'settings',
      settings: { inactivityDays: 0 },
    }).success,
  ).toBe(false);
  expect(
    sessionSchema.safeParse({
      id: crypto.randomUUID(),
      lastCheckAt: Date.now(),
      graceUntil: Date.now(),
      observations: {},
      lastCleanupAt: null,
      lastCleanupCount: 0,
      error: null,
    }).success,
  ).toBe(true);
  expect(attempts).not.toHaveBeenCalled();
});
