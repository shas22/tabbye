# Tabbye

[![Checks](https://github.com/OWNER/tabbye/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/tabbye/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Bye, tabs. Not your links.**

Tabbye is a local-only browser extension that saves and closes tabs you have stopped visiting. Search and reopen links from the toolbar popup, or open the full archive to browse by date and manage them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/archive-dark.png" />
  <img alt="The Tabbye archive page: a lifetime count of archived tabs, a search field, and saved links grouped by day" src="docs/images/archive-light.png" />
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/popup-dark.png" />
  <img alt="The Tabbye toolbar popup with search, recently archived links, and pause and open-archive controls" src="docs/images/popup-light.png" width="320" />
</picture>

Built with TypeScript, React, and WXT for Manifest V3. It's meant for desktop Chrome, Brave, and Vivaldi on Chromium 121 or later, but so far it has only been tested in Chromium ([testing](docs/testing.md)).

## Try it locally

Requires Node.js 22.12+ and Bun 1.3.14.

```sh
bun install --frozen-lockfile
bun run build
```

1. Open `chrome://extensions`, `brave://extensions`, or `vivaldi://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select `.output/chrome-mv3`.
3. Pin Tabbye to the toolbar and open it, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>. Choose **Settings**, or right-click the toolbar icon and choose **Options**, to change the timeout or exclude websites.

Tabbye starts with the browser's last-visited time for each tab. With the default settings, eligible tabs last visited at least a week ago can start being archived after the initial five-minute grace period. Pin anything you want to keep open. **Skip wait**, next to the countdown, starts cleanup right away.

## What it does

- Archives HTTP(S) tabs after seven days without a visit by default; choose 1–365 days.
- Saves the title and link before it closes a tab.
- Leaves alone the active tab in each window, selected tabs, pinned tabs, tabs still loading, and tabs playing audio.
- Skips websites you exclude, including their subdomains.
- Counts time while the computer sleeps, with a five-minute grace period after startup or a detected gap of more than two minutes between cleanup checks.
- Keeps a link in the archive when you reopen it. Deleting asks first.
- Search, pagination, pause and resume, and JSON export and import.
- Opens the popup with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>; change or remove the shortcut at `chrome://extensions/shortcuts`.
- Reuses an open archive or settings tab instead of opening another.
- Keeps a running count of tabs it has closed for you in this browser. Deleting links doesn't lower it, and imports don't raise it.
- No accounts, telemetry, remote assets, or server. Everything stays in your browser profile.

Saved link metadata includes the URL, title, last-used and archive times, and closure status. Unsaved form input, scroll position, back/forward history, and tab groups are lost when a tab closes, and Tabbye can't tell whether a page has unsaved edits, so pin anything you're in the middle of. Cleanup timing is approximate because Chrome can delay alarms. Private windows and non-web tabs are ignored.

Some browsers reset a tab's last-visited time when restoring a session, which delays cleanup for those tabs. Uninstalling Tabbye deletes its archive, so export it first.

## Development

```sh
bun run dev            # WXT development build; use an isolated browser profile
bun run check          # Formatting, lint, typecheck, unit/integration tests, build
bunx playwright install chromium
bun run test:e2e       # Requires the production build from check/build
bun run screenshots    # Regenerates docs/images from the production build
bun run zip            # .output/tabbye-0.1.0-chrome.zip
bun run build:profile  # Developer profiling build: .output/profile/chrome-mv3
bun run benchmark      # In-memory service benchmark: .output/benchmark.json
```

`bun run dev` is fine for UI work, but test anything involving the background worker with a production build, since the dev server keeps the worker alive.

[Performance](docs/performance.md) covers the profiling build, the benchmark, and measuring real CPU and memory in Chrome.

## Architecture

| Area              | Responsibility                                                         |
| ----------------- | ---------------------------------------------------------------------- |
| `src/domain`      | Pure inactivity rules, types, validation                               |
| `src/application` | Cleanup and archive workflows; narrow browser/storage/clock interfaces |
| `src/platform`    | Browser API and storage adapters                                       |
| `src/ui`          | React popup, archive, settings, and typed message client               |
| `src/entrypoints` | Worker/page startup and dependency wiring                              |

The background worker is the only code that writes to storage. Before closing a tab it saves the link, then checks the tab again, and leaves it open if anything changed. If the worker is interrupted, the next run just starts again from the live tabs.

More detail: [architecture](docs/architecture.md), [design decisions](docs/decisions.md), [testing](docs/testing.md), [contributing](CONTRIBUTING.md), [security](SECURITY.md), [privacy](PRIVACY.md), and the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE). Copyright © 2026 Tabbye contributors.
