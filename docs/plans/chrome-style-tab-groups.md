# Implementation status — 2026-09-28

Implemented in the current working tree:

- Dedicated bookmark library and editor: folders, search, add/edit/move/remove, bookmark star, window bookmarks, omnibox integration. Existing encrypted v1 records/IDs remain intact as the wire compatibility format for bookmark folders and links.
- Retired the old Groups navigator, manager, picker, and their UI tests. Legacy record APIs remain for compatibility and migration, not as a navigation feature.
- Misty tab groups attach to visible layout tabs, including split trees and all Misty surfaces. Name/color, collapse/expand, add/remove tabs, whole-group drag and keyboard reordering, ungroup, close/save/reopen, delete, and move to a new virtual window.
- Collapse retains running views. Focusing a hidden member expands its group. Closing checks all members for unsaved work before any mutation. Private layouts are excluded from saved groups.
- Old saved website groups migrate once to closed saved groups while their links remain available as bookmark folders. New bookmark folders do not become tab groups.
- Global navigation defaults to a 56px icon rail, with expand and hide controls retained. Space navigation uses a 208px named list and named management controls.

Current boundary: new tab-group metadata and saved groups are device-local, persisted in the account-bound workspace/recovery store. Bookmarks keep the existing encrypted browser-sync format. Remote tab projections retain this device's known group membership. Cross-device tab-group transfer is **not implemented**; the native strict sync schema and a version/capability migration remain necessary. The proposal below describes that future shared-state design, not shipped sync behavior.

Verification: focused feature, navigation, browser-source, and native-recovery tests pass; TypeScript and targeted ESLint pass. Real component previews inspected at 1103×824 and 640×760, including horizontal/vertical tabs and the named Space sidebar. Tests use synthetic fixture data, not a live signed-in session. A pre-existing SpaceWorkspaceRail test expects a Settings link absent from its unchanged management API; that unrelated test remains failing.

---

# Chrome-style tab groups for Misty

Research date: 2026-09-28. Status: proposal, not implemented. The user wants to
retire the current Groups feature and adopt Chrome's tab grouping interaction.
The recommendations below are provisional pending the two scope/migration
preferences requested in chat. No existing groups or saved links were modified.

## Reference behavior

Chrome puts a colored group label immediately before its member tabs. The group
color connects the label and tabs along the strip. A click folds/unfolds the
members; a context menu edits the name/color. Dragging the header moves the
group, while individual tabs can enter or leave it. Creation is available from
a tab's context menu. Google's [official illustrated guide](https://www.google.com/chrome/tips/)
shows the interaction, including this [name/color menu](https://www.google.com/chrome/static/images/tips/color-groups.webp).
The illustration is a visual reference; its older menu is not the complete
current feature inventory.

Chrome distinguishes three operations: collapse hides member tabs in the strip;
close saves the group for reopening; delete removes the saved group. Ungroup
keeps the tabs open. Group changes sync when the relevant account sync is on.
See the [current desktop help](https://support.google.com/chrome/answer/2391819?co=GENIE.Platform%3DDesktop&hl=en-en).

Keyboard users can focus the header and toggle it with Enter/Space, with menu
alternatives to drag actions. See [Google's keyboard guide](https://support.google.com/chrome/answer/10483214?hl=en-en).

Chromium moves selection outside a group when the active member is collapsed,
creating an ungrouped tab if necessary. Activating a hidden member expands its
group. These details avoid an active page with no visible tab:
[controller](https://chromium.googlesource.com/chromium/src/+/df810005aa918047e2613171d3cd863ce715108b/chrome/browser/ui/views/tabs/browser_tab_strip_controller.cc),
[tab strip](https://chromium.googlesource.com/chromium/src/+/b8ab8b36cc78700c31fce9e9c3ad73694b53efaf/chrome/browser/ui/views/tabs/tab_strip.cc).

## Proposed Misty experience

- Remove the Groups section from the global navigator and retire its manager
  popup as a tab-organization surface. Create and edit groups directly where the
  tabs live, with a compact name field, color swatches, and group actions.
- Support all visible window tabs, including Browser, Files, Agents and split
  views. This is a Misty extension of the reference, not a claim about Chrome.
  A split view remains one grouped tab with its existing panes intact.
- Horizontal strips use a colored label and thin connecting line. Left/right
  strips use the same label above indented members and a vertical color marker.
  Match Misty's existing type, surfaces and control sizes. Group color is an
  accent, and names/expanded state remain understandable without color.
- A group remains a contiguous block. Dragging its label moves every member;
  dragging a tab into/out of the block changes membership. Provide explicit
  menu and keyboard alternatives. Moving a group between Misty windows retains
  its contents and each tab's split layout.
- Use a small saved-tab-groups menu near the tab strip to reopen closed groups;
  do not recreate the old permanent Groups sidebar. Selecting an already-open
  group focuses it instead of creating duplicates.

| Action | Proposed result |
| --- | --- |
| Add to new/existing group | Move selected tabs into one contiguous group |
| Click group label | Collapse or expand without closing the member tabs |
| New tab in group | Add a member, expand the group, select the new tab |
| Remove from group | Keep that tab open outside the group |
| Ungroup | Keep all tabs open and remove their group wrapper |
| Close group | Save its restorable contents, then close its live tabs |
| Reopen group | Restore its tab order and supported view state |
| Delete saved group | Explicitly remove the saved entry; separate from Close |

Bookmarks stay ordinary saved links. Group membership follows the current tab,
including navigation to a different URL; it is not tied to the original saved
website address. Closing a group must honor existing unsaved-work handling.
Running agent work must not be implicitly canceled merely because its tab group
is collapsed or hidden.

## Fit with the current implementation

The visible tab strip is `src/app/layouts/DesktopLayout/WorkspaceLayoutTabs.tsx`.
It already supports horizontal and vertical positioning, pointer reordering,
keyboard selection, tab naming, and split-pane indicators. Extend this component
instead of introducing a second tab strip.

The groupable unit should be `WorkspaceLayoutTab` in
`src/features/workspace/model.ts`, which owns a whole split tree. The lower-level
`WorkspaceTab` represents a view inside a pane. Existing `groupKey` and
`groupInstanceId` have other workspace meanings and should not be repurposed.

The old saved-site feature is owned by
`src/features/browser-workspace/WebsiteGroupNavigator.tsx`,
`WebsiteGroupsManager.tsx`, and `navigation.ts`. Its `group`/`website` records
store saved addresses, independent of the pages those tabs later visit.

The dependency extends beyond the sidebar: `BrowserBookmarkDialog.tsx`,
`BrowserBookmarkStar.tsx`, `bookmarkWindowTabs.ts`, `BookmarksPage.tsx`, and
omnibox suggestions use those same saved website records. Retiring the Groups
UI must preserve bookmark operations and supply a separate bookmark destination.

## State and persistence

Introduce a durable tab-group identity, title, color, ordered membership and
saved/open lifecycle. Treat collapse and current selection as device-local UI
state; do not let a remote collapse hide the tab someone is currently using.
Use one source of truth for live membership, with an explicit restorable saved
representation when a group is closed. A closed group must not mount webviews.

This requires native changes as well as React. The existing encrypted workspace
projection passes through `src/features/browser-workspace/model.ts`,
`changes.ts`, `projection.ts`, `source.ts`, and the Rust document schema in
`src-tauri/crates/browser-sync/src/document/entities.rs`. That Rust schema
rejects unknown fields. A version/capability migration is required before new
group fields can travel between devices; a frontend-only addition would not
provide reliable persistence or sync.

Keep browser profile identity, private-tab exclusions and device-local Files
state intact. Existing sync deliberately does not copy local file paths to
other devices; reopening a mixed group there needs the current handoff/restore
mechanisms and an unavailable-view state where necessary. A saved group must
never imply that every member can restore identically on every machine.

## Migration and delivery

Recommended migration: preserve existing group names and URL order as closed
saved tab groups, without opening every page. Preserve bookmark records through
the bookmark migration as well. Keep legacy source data recoverable until the
versioned conversion is verified; use stable migration IDs to avoid duplicates
across retries/devices. The alternative requested for user selection is to keep
the old organization only as bookmark folders.

1. Define the versioned native/renderer group model, migration, invariant checks
   and restore behavior. Exercise old snapshots and mixed-client compatibility.
2. Add strip labels, group menus, membership actions, keyboard access and block
   reordering in every supported strip position. Preserve split layouts.
3. Complete close/reopen, cross-window movement and encrypted sync, then replace
   the legacy sidebar/manager and update bookmark entry points together.

Acceptance includes noncontiguous selection being gathered into a group,
collapse of the active/only group, last-member removal, canceled drag, adjacent
groups of the same color, long/empty names, keyboard-only operation, multiwindow
move, restart restoration, duplicate-free reopening, concurrent sync changes,
private tabs, missing device-local content, unsaved work, and idempotent legacy
migration. Collapse must preserve live view identity and must not itself reload
pages or stop agent work.

No Chrome extension, MCP server, or Chromium engine migration is needed. The
[Chrome extension API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
is useful as a behavioral reference; Misty's own shell and state must implement
the interaction.
