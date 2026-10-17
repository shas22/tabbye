// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Command } from '../src/application/protocol';
import { DEFAULT_SETTINGS, GRACE } from '../src/domain/model';
import { App } from '../src/ui/App';
import { fixture, NOW } from './helpers';

const client = vi.hoisted(() => ({
  request: vi.fn<(command: Command) => Promise<unknown>>(),
  openArchive: vi.fn<() => Promise<void>>(),
  openSettings: vi.fn<() => Promise<void>>(),
  subscribe: vi.fn(() => vi.fn()),
}));
vi.mock('../src/ui/client', () => client);

beforeEach(async () => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/archive.html');
  const { service } = await fixture();
  await service.handle({
    type: 'import',
    backup: {
      format: 'tabbye',
      version: 1,
      exportedAt: NOW,
      settings: DEFAULT_SETTINGS,
      entries: Array.from({ length: 8 }, (_, index) => ({
        id: crypto.randomUUID(),
        title: `Article ${index + 1}`,
        url: `https://example.com/${index + 1}`,
        archivedAt: NOW - index * 1000,
        lastUsedAt: NOW - index * 1000,
        outcome: 'closed' as const,
      })),
    },
  });
  client.request.mockImplementation((command) => service.handle(command));
  client.openArchive.mockResolvedValue(undefined);
  client.openSettings.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('searches the whole archive from the popup, resets pagination, and clears with Escape', async () => {
  const user = userEvent.setup();
  render(<App popup />);
  const search = screen.getByRole('searchbox', {
    name: 'Search archived links',
  });
  expect(search).toHaveFocus();
  await screen.findByRole('button', { name: 'Article 1' });
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Article 8' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: 'Article 8' });
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.type(search, 'Article 1');
  await screen.findByRole('button', { name: 'Article 1' });
  expect(client.request).toHaveBeenLastCalledWith({
    type: 'view',
    query: 'Article 1',
    page: 1,
    pageSize: 6,
  });
  expect(
    screen.queryByRole('button', { name: 'Article 8' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('navigation', { name: 'Archive pages' }),
  ).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(search).toHaveValue('');
  await screen.findByRole('button', { name: 'Article 6' });
  expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
});

it('opens the options page or archive from the popup', async () => {
  const user = userEvent.setup();
  render(<App popup />);
  await screen.findByRole('button', { name: 'Article 1' });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(client.openSettings).toHaveBeenCalledOnce();
  const open = screen.getByRole('button', { name: 'Open archive' });
  await waitFor(() => expect(open).toBeEnabled());
  await user.click(open);
  expect(client.openArchive).toHaveBeenLastCalledWith();
});

it('opens settings via its fragment and returns to the archive', async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, '', '#settings');
  render(<App />);
  await screen.findByRole('spinbutton', { name: 'Archive after' });
  expect(
    screen.getByRole('heading', { name: 'Settings', level: 1 }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  expect(
    screen.getByRole('heading', { name: 'Archive', level: 1 }),
  ).toBeInTheDocument();
  expect(window.location.hash).toBe('');
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
});

it('starts the options page on settings without a fragment', async () => {
  render(<App initialSection="settings" />);
  await screen.findByRole('spinbutton', { name: 'Archive after' });
  expect(
    screen.getByRole('heading', { name: 'Settings', level: 1 }),
  ).toBeInTheDocument();
});

it('keeps unsaved settings edits when cleanup is paused', async () => {
  const user = userEvent.setup();
  render(<App initialSection="settings" />);
  const days = await screen.findByRole('spinbutton', { name: 'Archive after' });
  await user.clear(days);
  await user.type(days, '30');
  await user.click(screen.getByRole('button', { name: 'Pause' }));
  await screen.findByText('Paused', { exact: true });
  expect(screen.getByRole('spinbutton', { name: 'Archive after' })).toHaveValue(
    30,
  );
});

it('pauses and resumes cleanup from the footer', async () => {
  const user = userEvent.setup();
  render(<App popup />);
  const pause = await screen.findByRole('button', {
    name: 'Pause',
  });
  // The control only becomes available after the worker returns settings.
  await waitFor(() => expect(pause).toBeEnabled());
  await user.click(pause);
  await screen.findByText('Paused', { exact: true });
  await user.click(screen.getByRole('button', { name: 'Resume' }));
  await screen.findByRole('button', { name: 'Pause' });
  expect(client.request).toHaveBeenCalledWith({
    type: 'settings',
    settings: { enabled: true },
  });
});

it('shows the remaining startup grace instead of implying cleanup is running', async () => {
  const now = Date.now();
  client.request.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    statistics: { lifetimeArchivedTabs: 0 },
    entries: [],
    total: 0,
    matching: 0,
    page: 1,
    pageSize: 6,
    graceUntil: now + GRACE,
    lastCleanupAt: null,
    lastCleanupCount: 0,
    error: null,
  });
  render(<App popup />);
  await screen.findByText('Cleanup starts in 5 min');
});

it('reports a loading failure and retries without presenting it as an empty archive', async () => {
  const user = userEvent.setup();
  client.request.mockRejectedValueOnce(
    new Error('Could not read saved links.'),
  );
  render(<App popup />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not read saved links.',
  );
  expect(screen.queryByText('No archived tabs yet')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: 'Article 1' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each([true, false])(
  'shows lifetime closures separately from saved or filtered links (popup=%s)',
  async (popup) => {
    const user = userEvent.setup();
    const f = await fixture();
    await f.endGrace();
    await f.service.cleanup();
    const saved = (await f.store.archives())[0]!;
    await f.service.handle({ type: 'delete', id: saved.id });
    client.request.mockImplementation((command) => f.service.handle(command));
    render(<App popup={popup} />);
    const statistic = await screen.findByRole('region', {
      name: 'Lifetime tabs archived',
    });
    expect(within(statistic).getByText('1')).toBeInTheDocument();
    expect(
      within(statistic).getByText('tab archived', { exact: true }),
    ).toBeInTheDocument();
    expect(within(statistic).getByText(/All time/)).toHaveTextContent(
      'this browser',
    );
    expect(screen.getByText('No archived tabs yet')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'no results');
    await screen.findByText('No matching links');
    expect(within(statistic).getByText('1')).toBeInTheDocument();
    expect(statistic).toHaveAccessibleDescription(
      /imported links aren't counted/,
    );
  },
);

it.each([true, false])(
  'skips a countdown and refreshes the archive immediately (popup=%s)',
  async (popup) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const user = userEvent.setup();
    const f = await fixture();
    client.request.mockImplementation((command) => f.service.handle(command));
    render(<App popup={popup} />);
    const skip = await screen.findByRole('button', { name: 'Skip wait' });
    expect(screen.getByText('Cleanup starts in 5 min')).toBeInTheDocument();
    await user.click(skip);
    await screen.findByRole('button', { name: 'A useful article' });
    expect(client.request).toHaveBeenCalledWith({ type: 'skip-wait' });
    expect(
      screen.queryByRole('button', { name: 'Skip wait' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('After 7 days')).toBeInTheDocument();
  },
);

it('hides the override while paused and restores it on resume during grace', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const user = userEvent.setup();
  render(<App popup />);
  await screen.findByRole('button', { name: 'Skip wait' });
  await user.click(screen.getByRole('button', { name: 'Pause' }));
  await screen.findByText('Paused', { exact: true });
  expect(
    screen.queryByRole('button', { name: 'Skip wait' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Resume' }));
  await screen.findByRole('button', { name: 'Skip wait' });
});

it('disables repeated clicks while the override is pending and reports a failed request', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const user = userEvent.setup();
  const f = await fixture();
  let rejectOverride: (error: Error) => void = () => {
    throw new Error('No override in progress');
  };
  client.request.mockImplementation((command) =>
    command.type === 'skip-wait'
      ? new Promise((_resolve, reject) => {
          rejectOverride = reject;
        })
      : f.service.handle(command),
  );
  render(<App popup />);
  const skip = await screen.findByRole('button', { name: 'Skip wait' });
  await user.click(skip);
  expect(skip).toBeDisabled();
  await user.click(skip);
  expect(
    client.request.mock.calls.filter(
      ([command]) => command.type === 'skip-wait',
    ),
  ).toHaveLength(1);
  rejectOverride(new Error('Could not start cleanup.'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not start cleanup.',
  );
  expect(skip).toBeEnabled();
});
