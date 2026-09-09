# Navigation names and personal aliases

Implemented September 8, 2026 in the existing development checkout.

Groups use the stable app name, individual tabs use the current content title,
and embedded headers put the platform first. For Instagram Messages the three
labels are Social, Messages · Instagram, and Instagram · Messages. Recognizable
provider unread counts are shown separately in the embedded header. Redirects
retain the provider and show the real destination hostname. Account suffixes
come from existing profile labels, never page-title identity inference.

Right-click Misty navigation labels for Rename… and Reset name. The inline editor
selects the current label; Enter/blur saves and Escape cancels. Names are trimmed,
single-line, and limited to 120 Unicode characters. Aliases do not change files,
documents, Spaces, accounts, routes, or automatic SDK title updates.

## Storage and identity

The native host owns the environment-resolved config/navigation.json file
(normally ~/.misty/config/navigation.json). Version 1 stores an accounts map,
keyed by the resolved backend URL and Misty account ID. Each account maps stable
navigation IDs to strings. Sidebar sections and platform entries span Spaces;
tabs and groups use instance IDs. Pin aliases use the pin ID, independent of its
parent position. Files inner tabs get separate persistent naming UUIDs; their
existing workspace configuration remains separate.

Writes are serialized, merged with the latest valid file, and atomically renamed
from private temporary files. Native commands reject webviews other than the
trusted main shell. Navigation waits for the first snapshot; other windows and
valid external edits refresh every two seconds and on focus. Invalid edits keep
the last valid in-memory snapshot, report an error, and are not overwritten.
Reset removes one override. The window menu can explicitly discard closed tab
and window history and prune its unused aliases.

Workspace persistence is now version 10. Existing tab IDs survive restoration;
groups acquire stable instance IDs without treating old generated titles as
aliases. Whole-group moves preserve identity, splits get new group identities,
and merges retain the destination identity. Fresh tabs have no tab alias.

## Validation

- Focused frontend checks passed for formatting, alias precedence/reset,
  account isolation, restoration, migration, group movement, sidebar rendering,
  Files tab rendering, validation/write failures, and Enter/blur/Escape behavior.
- The nested group-dropdown test covers individual-tab renaming without changing
  the group alias; its focus handling was corrected during verification.
- Native persistence tests passed (3): concurrent updates, reload/reset,
  malformed and valid external edits, restart, isolation, validation, and a real
  filesystem permission failure preserving the previous file.
- TypeScript checking and all official app package builds passed. Files was
  rebuilt again after the final tab-tooltip adjustment.
- A disposable macOS host check passed with a native child webview present:
  config save/reload/reset/isolation, concurrent saves, selected inline text,
  Enter/Escape, and focus restoration. It uses temporary app data and profiles,
  leaving personal sessions and aliases untouched.

Reproduce the native check from the host checkout:

    MISTY_NAVIGATION_NAMES_PROBE=1 node scripts/sdk-package-probe-run.mjs browser ../misty-apps

The probe lives in scripts/navigation-names-probe.tsx and is available only in the
existing debug verification harness. Restart a previously running desktop build
to load the new native configuration commands. No backend schema or cross-device
sync changes are included.
