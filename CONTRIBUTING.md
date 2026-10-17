# Contributing to Tabbye

Small, focused changes are welcome. For a bigger change in behavior, open an issue first describing the problem and the tradeoffs.

## Get started

You need Node.js 22.12+ and Bun 1.3.14. Install with `bun install --frozen-lockfile` and start a dev build with `bun run dev`. Load it in a separate browser profile with tabs you don't mind losing, since it will close old tabs once the grace period is over.

## Before submitting

```sh
bun run format
bun run check
bunx playwright install chromium
bun run test:e2e
```

In the pull request, say what problem it solves, what changed, and what you ran. Add light and dark screenshots for UI changes. If you tested in a particular browser, add the version, OS, and result to [testing](docs/testing.md).

## Code conventions

- Business rules go in `src/domain` and `src/application`, browser APIs in `src/platform` and the entrypoints, and React in `src/ui`. ESLint enforces the main boundaries.
- Validate messages, imports, and stored data at runtime; TypeScript types alone aren't enough. Change the stored format only with a versioned migration, and never clear the archive because it failed to parse.
- Only close a tab after its archive record is saved and a fresh eligibility check passes. Tests should check behavior a user would see, and shouldn't loosen a protection to get a pass.
- Don't log URLs, titles, imported data, or raw storage errors. New network requests, analytics, or permissions need a clear reason in the PR.

CI runs these checks plus the browser tests. If you change dependencies, commit the updated `bun.lock`; CI won't update it for you.

## Reporting problems

Include steps to reproduce, your browser and OS versions, and what you expected versus what happened. Replace private URLs and titles with made-up ones, and don't attach your archive or browser profile. Report security issues through the [security policy](SECURITY.md), not a public issue.
