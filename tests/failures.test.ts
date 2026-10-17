import { expect, it } from 'vitest';
import { failureSummary } from '../src/application/failures';
import { sessionSchema } from '../src/domain/model';

it('explains validation errors without disclosing rejected values or arbitrary keys', () => {
  const result = sessionSchema.safeParse({
    id: crypto.randomUUID(),
    lastCheckAt: Date.now(),
    graceUntil: Date.now(),
    lastCleanupAt: null,
    lastCleanupCount: 0,
    error: null,
    observations: {
      'private-tab-title': {
        token: crypto.randomUUID(),
        url: 'https://private.example/token',
        lastUsedAt: 'private-value',
        wasActive: false,
      },
    },
  });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected invalid timestamp');
  const message = failureSummary(result.error);
  expect(message).toContain('lastUsedAt: invalid_type');
  expect(message).not.toMatch(/private|https/);
});

it('classifies storage failures without echoing raw browser error messages', () => {
  const message = failureSummary(
    new Error('QUOTA_BYTES exceeded for https://private.example'),
  );
  expect(message).toContain('storage quota');
  expect(message).not.toContain('private');
  expect(failureSummary(new Error('Secret page title'))).not.toContain(
    'Secret',
  );
});
