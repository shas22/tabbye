// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ArchiveRow } from '../src/ui/components';
import { SettingsPanel } from '../src/ui/Settings';
import { DEFAULT_SETTINGS } from '../src/domain/model';
import { NOW } from './helpers';

afterEach(cleanup);

it('keeps deletion separate from reopening and requires explicit confirmation', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  render(
    <ArchiveRow
      entry={{
        id: crypto.randomUUID(),
        title: '<script>not markup</script>',
        url: 'https://example.com',
        archivedAt: NOW,
        lastUsedAt: NOW,
        outcome: 'closed',
      }}
      busy={false}
      onOpen={onOpen}
      onDelete={onDelete}
    />,
  );
  expect(document.querySelector('script')).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Reopen <script>not markup</script>' }),
  );
  expect(onOpen).toHaveBeenCalledOnce();
  await user.click(
    screen.getByRole('button', {
      name: '<script>not markup</script>',
    }),
  );
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(onDelete).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Delete <script>not markup</script>' }),
  );
  expect(onDelete).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(
    screen.getByRole('button', {
      name: '<script>not markup</script>',
    }),
  ).toHaveFocus();
  expect(onDelete).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Delete <script>not markup</script>' }),
  );
  await user.keyboard('{Enter}');
  expect(onDelete).toHaveBeenCalledOnce();
});

it('validates settings before saving and explains invalid exclusions', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(
    <SettingsPanel settings={DEFAULT_SETTINGS} busy={false} onSave={onSave} />,
  );
  await user.type(
    screen.getByLabelText('Excluded websites'),
    'https://example.com',
  );
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a hostname');
  expect(onSave).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Excluded websites'));
  await user.type(screen.getByLabelText('Excluded websites'), 'Example.com');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(onSave).toHaveBeenCalledWith({
    inactivityDays: 7,
    excludedDomains: ['example.com'],
  });
});
