---
name: Misty saved-website Groups retirement
description: Supersession notice for the retired Groups popup and navigator.
---

# Design System: Retired Groups popup

## Overview

The saved-website Groups popup and navigator described by the previous version of this document have been removed. Its popup composition, inline Add site form, and group-deletion behavior are superseded; do not recreate them from the old record or captures.

Use the scoped replacement documents:

- [Bookmark library](../bookmarks/DESIGN.md): saved links, folders, search, and bookmark editing. Existing encrypted v1 `group`/`website` record names and IDs remain compatibility details for these bookmarks.
- [Tab groups and global navigation](../../app/layouts/DesktopLayout/DESIGN.md): colored groups on visible Misty tabs, the anchored nonmodal editor, saved-group actions, and compact/expanded global navigation. Open groups sync as encrypted `tab_group` records and saved groups in the vault's collections once every device understands them; until then they stay on each device. Collapsed state is always local.
- [Named Space navigation](../spaces/components/DESIGN.md): the full labeled Space sidebar retained beside the global icon rail.

These changes extend Misty's existing charcoal and cream theme and shared controls without replacing unrelated browser-workspace design decisions. Historical `.impeccable/review/groups` captures and their earlier verdict apply to the retired popup, not its replacements. Current synthetic-preview evidence and the bounded reviewer/validation record are linked from the replacement documents.
