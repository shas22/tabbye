# Tabbye privacy

Tabbye does not operate a server, collect analytics, send telemetry, load remote assets, or transmit your archive to a third party.

## Data stored on your device

- Archived page URLs and titles, last-used and saved timestamps, and whether the close operation completed.
- Your timeout, pause setting, and excluded domains.
- A lifetime count of recorded automatic tab closures, stored locally without individual deleted-link details.
- Temporary tab observations and cleanup status for the current browser session.

Archives, settings, and the lifetime count use the extension’s local storage in the current browser profile. Temporary observations use session storage, which survives worker suspension but is cleared on browser restart, extension reload, update, or disable. URLs can contain private search terms or access tokens; exported backups contain the saved URLs in plain text. The extension does not provide its own encryption.

## Permissions

| Permission | Purpose                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `tabs`     | Read tab URLs, titles, and browser state needed to save eligible links. |
| `storage`  | Store archives, settings, and activity observations locally.            |
| `alarms`   | Schedule periodic cleanup while allowing the worker to sleep.           |

There are no content scripts or website access permissions. Tabbye does not read page bodies, forms, keystrokes, cookies, or full browsing history. Private windows are not supported.

## Your control

Pause cleanup, exclude domains, reopen links, or delete individual archive entries. Export makes a local JSON file. Import merges saved links by ID and does not apply imported settings. Reopening a link navigates to that website normally, which makes the website’s usual network requests.

Deleting an archived link keeps the aggregate lifetime count. The count is not included in JSON backups or changed by imports. Removing the extension deletes its local archive, settings, and lifetime count. Files you exported remain wherever you saved them. Browser/OS backups and profile management are outside Tabbye’s control.
