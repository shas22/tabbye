import { z } from '../domain/validation';

// Only schema-owned field names and issue codes can enter diagnostics. Never
// expose rejected values, arbitrary object keys, raw browser errors, or URLs.
const fields = new Set([
  'version',
  'enabled',
  'inactivityDays',
  'excludedDomains',
  'id',
  'url',
  'title',
  'lastUsedAt',
  'archivedAt',
  'outcome',
  'operationKey',
  'token',
  'wasActive',
  'lastCheckAt',
  'graceUntil',
  'lastCleanupAt',
  'lastCleanupCount',
  'lifetimeArchivedTabs',
]);

export function failureSummary(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 3).map((issue) => {
      const field = issue.path.findLast(
        (part): part is string => typeof part === 'string' && fields.has(part),
      );
      return `${field ?? 'record'}: ${issue.code}`;
    });
    return `Data validation failed (${issues.join('; ')}).`;
  }
  if (
    error instanceof Error &&
    /quota|QUOTA_BYTES|MAX_WRITE_OPERATIONS/i.test(error.message)
  ) {
    return 'The browser storage quota was reached. Export your archive and free some space.';
  }
  if (
    error instanceof Error &&
    /permission|access denied|not allowed/i.test(error.message)
  ) {
    return 'The browser denied access to an extension API. Check extension permissions.';
  }
  return 'A browser or storage operation failed. Reload the extension and try again.';
}
