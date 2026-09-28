---
name: Misty bookmark library
description: Saved links and folders in the existing Misty internal-page shell.
colors:
  background: "var(--misty-theme-bg)"
  surface: "var(--misty-theme-card)"
  border: "var(--misty-theme-border)"
  text: "var(--misty-theme-text)"
  text-bright: "var(--misty-theme-text-bright)"
  text-muted: "var(--misty-theme-text-muted)"
typography:
  title:
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontSize: "14px"
  detail:
    fontSize: "12px"
---

# Design System: Bookmark library

## Overview

This document covers the dedicated Bookmarks page and bookmark editor, including their use from browser chrome. It extends Misty's incumbent charcoal and cream surfaces, application typography, and shared controls. The approved extension brief and built components are the authority; this is not a new product identity or speculative product brief.

Bookmarks are saved links organized into folders. Live tab groups belong to the visible workspace tab strip, documented in [DesktopLayout](../../app/layouts/DesktopLayout/DESIGN.md). The former Groups popup is retired.

Sources: [library.ts](library.ts), [BookmarkEditor.tsx](BookmarkEditor.tsx), [BookmarksPage.tsx](../browser/internal/BookmarksPage.tsx), [InternalPageFrame.tsx](../browser/internal/InternalPageFrame.tsx), and shared controls under `src/shared/ui`.

## Colors

Keep the neutral theme tokens live-bound to the application palette. Bright text identifies page and bookmark names; muted text supports URLs, folder attribution, search icons, and empty-state detail. Selected folder filters and hover rows use shared control fills. Folder identity does not receive a tab-group color.

## Typography

Inherit application typography. Use the title role for the page heading, body text for bookmark names and folder controls, and detail text for URLs and folder attribution. Preserve the shared dialog's title and input styles in the editor. Long names, URLs, and folder names truncate within their flexible slots.

## Layout

The page fills its browser content area. A wrapping header holds the title, search, and Add menu; the body scrolls independently. Keep the centered content column bounded (768px), with horizontal page padding (24px). Search occupies a full available row at narrow widths and a compact fixed-width slot from the shared small breakpoint.

Folder filters wrap above one flat bookmark list. The selected folder has its own name and management menu above the list. In All bookmarks, rows add muted folder attribution at the trailing edge. Keep each title and URL together, with its site icon at the left and actions at the right.

Bookmark and folder editors use the shared content-height dialog, with compact preferred width (384px) from the small breakpoint and viewport-bounded scrolling. The bookmark form orders Name, Address, Folder, and conditional Folder name, followed by validation and actions.

## Elevation & Depth

The library is a flat application page. Use the existing header divider, row hover fills, and shared floating-menu treatment. Bookmark editing uses the shared modal dialog surface and backdrop; its interaction differs from the nonmodal tab-group editor.

## Shapes

Retain shared rounded buttons, fields, list rows, menus, and dialogs. Folder filters are ordinary small buttons, with selected state exposed through `aria-pressed`. Do not add a separate card around each bookmark.

## Components

- **Library:** Search matches bookmark names and addresses within the selected folder or all bookmarks. Keep empty-library and no-match messages distinct. Normal activation opens the link in the current view; Command/Ctrl activation and the row menu can open a new tab.
- **Folders:** All bookmarks restores the combined list. The selected folder menu offers opening matching links in new tabs, renaming, and Remove folder, keep bookmarks. The default Bookmarks folder cannot be removed. Removing another folder retains its links in the default folder.
- **Editor:** Reuse `Field`, `Input`, `Select`, and `Button`. Name has initial focus. New folder reveals its field in place. Save validates the address and displays failures beside the form; Cancel dismisses the draft. Existing bookmarks expose Remove bookmark. Keep the mounted draft independent of external updates.
- **Compatibility:** Existing encrypted v1 `group` and `website` records and IDs remain the wire representation for folders and links. Legacy names are implementation details, not UI labels to restore. New bookmark folders do not create live or saved tab groups.

**The Saved-Link Rule.** A bookmark preserves a saved address; a tab group organizes open workspace tabs. Keep their names, actions, and lifecycles distinct.

## Do's and Don'ts

- **Do** reuse the internal-page frame and shared controls.
- **Do** retain links when removing their folder and state that outcome in the action label.
- **Do** retain accessible labels, pressed states, action names, and inline errors.
- **Don't** restore the saved-website Groups navigator, popup, or destructive folder-removal semantics.
- **Don't** present local tab-group recovery as cross-device bookmark synchronization.

This scoped record does not regenerate root tokens or a root `.impeccable/design.json` sidecar. The [DesktopLayout review record](../../app/layouts/DesktopLayout/DESIGN.md) identifies the synthetic component captures, reviewer scope, and validation boundary for this change. Those previews do not prove a native live signed-in session.
