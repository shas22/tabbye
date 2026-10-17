# Security policy

## Supported versions

Only the latest release receives security fixes.

## Scope

Tabbye runs entirely in your browser. It has no server, accounts, or network requests of its own, and it requests only the `tabs`, `storage`, and `alarms` permissions. Relevant reports include, for example:

- A website, another extension, or a crafted backup file causing Tabbye to read or change its archive, open unexpected URLs, or close tabs it should protect.
- Saved URLs, titles, or settings leaving the device, or appearing in logs.
- A permission or manifest change that grants more access than the features need.

## Reporting a vulnerability

Please report privately through GitHub's [private vulnerability reporting](https://github.com/OWNER/tabbye/security/advisories/new) rather than in a public issue.

Include the browser and version, operating system, Tabbye version, and steps to reproduce. Replace private URLs and titles with harmless examples, and do not attach a personal archive or browser profile.

The report will be acknowledged and you will be kept informed about a fix. Once a fix is released, the advisory is published with credit to the reporter unless you prefer otherwise.
