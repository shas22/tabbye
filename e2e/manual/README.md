# Manual Vivaldi checks

Vivaldi has its own pinned stacks, workspaces, tiling, and hibernation, and the automated tests can't set those up. This procedure checks by hand that Tabbye still leaves the right tabs open.

Run each row twice, once through alarm cleanup and once through **Skip wait**, each time in a fresh throwaway profile. The steps fake the worker's clock, so never run them in a profile you actually use.

| Case                      | Setup in Vivaldi                                                                                | Expected                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Pinned tab                | Pin tab A from the tab context menu and leave it inactive.                                      | A stays open and isn't archived.                                                               |
| Pinned stack              | Stack A and B, pin the stack, and deselect both. Try it collapsed and expanded.                 | Both stay open and neither is archived. Check each tab's `pinned` flag.                        |
| Unpinned stack            | Stack A and B without pinning, and leave the stack inactive.                                    | Being in a stack isn't a protection, so expired members close.                                 |
| Pinned, other workspace   | Move A to a second workspace, pin it, and switch back.                                          | A stays open and isn't archived. Note whether `tabs.query` returns it.                         |
| Unpinned, other workspace | Move A and B to another workspace and switch back.                                              | Note what `tabs.query` returns and the flags. A hidden workspace doesn't protect a tab.        |
| Tiled tabs                | Tile A and B with one tile focused. In a separate run, tile them with the archive page focused. | Note which tiles are active or selected and which close. Tiling on its own isn't a protection. |
| Hibernated tab            | Hibernate inactive tab A. If Vivaldi allows it, repeat with A pinned.                           | An expired, unprotected tab still closes. A pinned hibernated tab stays open.                  |

Do the setup through Vivaldi's own UI, following its guides to [tab stacks](https://help.vivaldi.com/desktop/tabs/tab-stacks/), [workspaces](https://help.vivaldi.com/desktop/tabs/workspaces/), and [tiling](https://help.vivaldi.com/desktop/tabs/tab-tiling/). Calling `chrome.tabs.update({ pinned: true })` or editing profile data directly doesn't test the same thing.

## Set up

From the repository root, serve the test page in one terminal:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory e2e/manual
```

In another terminal, start Vivaldi with a temporary profile:

```sh
tabbye_test_profile="$(mktemp -d "${TMPDIR:-/tmp}/tabbye-native.XXXXXX")"
'/Applications/Vivaldi.app/Contents/MacOS/Vivaldi' \
  --user-data-dir="$tabbye_test_profile" --no-first-run
```

Load `.output/chrome-mv3` from `vivaldi://extensions`, pause Tabbye, and keep the defaults (seven days, no excluded websites). Open `http://127.0.0.1:8765/fixture.html` and use its links to open the row's tabs plus one ordinary tab. The ordinary tab is the control: if it doesn't close, cleanup didn't run and the row tells you nothing. Close the fixture page and any other web tabs, including welcome pages.

Do the Vivaldi setup for the row, then open Tabbye's archive page and leave it selected, unless the row asks for a focused tile. The ordinary tab should be inactive, unselected, unpinned, fully loaded, and silent.

## Fake the clock

In the **archive page** console, flush any pending worker events with a normal request:

```js
await chrome.runtime.sendMessage({
  type: 'view',
  query: '',
  page: 1,
  pageSize: 20,
});
```

Then open the **service worker** console and run the snippet below. Keep that inspector open, since the faked clock only exists in that worker, and don't touch the test tabs afterwards. Set `tabbyeTrigger` to `'alarm'` or `'skip-wait'`.

```js
var tabbyeTrigger = 'alarm';
var tabbyeOrigin = 'http://127.0.0.1:8765/';
var tabbyeBefore = (await chrome.tabs.query({ windowType: 'normal' })).filter(
  (tab) => tab.url?.startsWith(tabbyeOrigin),
);
console.table(
  tabbyeBefore.map(
    ({
      id,
      url,
      pinned,
      active,
      highlighted,
      audible,
      status,
      lastAccessed,
      discarded,
      groupId,
    }) => ({
      id,
      url,
      pinned,
      active,
      highlighted,
      audible,
      status,
      lastAccessed,
      discarded,
      groupId,
    }),
  ),
);
var tabbyeInitialLocal = await chrome.storage.local.get(null);
await chrome.alarms.clear('tabbye-cleanup');
var tabbyeFuture = Date.now() + 8 * 24 * 60 * 60 * 1000;
Date.now = () => tabbyeFuture;
var tabbyeSession = (await chrome.storage.session.get('session')).session;
await chrome.storage.session.set({
  session: {
    ...tabbyeSession,
    observations: {},
    lastCheckAt: tabbyeFuture,
    graceUntil:
      tabbyeTrigger === 'skip-wait' ? tabbyeFuture + 5 * 60 * 1000 : 0,
  },
});
await chrome.storage.local.set({
  settings: {
    enabled: true,
    inactivityDays: 7,
    excludedDomains: [],
  },
});
```

Check that every inactive test tab and the ordinary tab have a `lastAccessed` at least seven days before `tabbyeFuture`. If a timestamp is missing or invalid, or a pinned tab is also active or selected, the run says nothing about pinning, so set it up again. For other workspaces, compare Vivaldi's Windows panel with `tabs.query`; a tab missing from the query doesn't prove pinning worked.

## Run cleanup

Go back to the **archive page** console. It still has the real clock, so don't schedule anything from the worker's faked time. For alarm cleanup:

```js
await chrome.alarms.create('tabbye-cleanup', { when: Date.now() + 100 });
```

For Skip wait:

```js
await chrome.runtime.sendMessage({ type: 'skip-wait' });
```

## Check the result

In the **worker** console, wait until `session.lastCleanupAt` equals `tabbyeFuture`, then run:

```js
var tabbyeAfterSession = (await chrome.storage.session.get('session')).session;
var tabbyeAfterLocal = await chrome.storage.local.get(null);
var tabbyeAfter = (await chrome.tabs.query({ windowType: 'normal' })).filter(
  (tab) => tab.url?.startsWith(tabbyeOrigin),
);
console.log(
  JSON.stringify(
    {
      trigger: tabbyeTrigger,
      checkTime: tabbyeFuture,
      lastCleanupAt: tabbyeAfterSession.lastCleanupAt,
      error: tabbyeAfterSession.error,
      before: tabbyeBefore,
      after: tabbyeAfter,
      archives: Object.entries(tabbyeAfterLocal)
        .filter(([key]) => key.startsWith('archive:'))
        .map(([, value]) => value),
      lifetimeBefore: tabbyeInitialLocal.statistics.lifetimeArchivedTabs,
      lifetimeAfter: tabbyeAfterLocal.statistics.lifetimeArchivedTabs,
    },
    null,
    2,
  ),
);
```

`error` should be `null`. The ordinary tab should be gone, with one `closed` archive record and one more on the lifetime count. Every other tab that closed should have exactly one record, protected tabs should have none, and the lifetime count should go up by the number of tabs closed. Save the output with screenshots of the Vivaldi setup, and add a row to the [results table](../../docs/tab-protection.md#results).

If a pinned tab or a member of a pinned stack closes, that's a bug. Write down the setup, the flags, and what happened on both cleanup paths, and keep Vivaldi marked as unverified until it's fixed. Report tiles that close unexpectedly too, even though that follows the current rules.

When you're done, close Vivaldi, delete the temporary profile, and stop the server. Don't reuse that worker or profile for normal browsing.
