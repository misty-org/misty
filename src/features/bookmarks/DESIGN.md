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
    fontSize: "20px"
    fontWeight: 500
  body:
    fontSize: "14px"
  detail:
    fontSize: "12px"
---

# Design System: Bookmark library

## Overview

This document covers the dedicated Bookmarks page and bookmark editor, including their use from browser chrome. It extends Misty's incumbent charcoal and cream surfaces, application typography, and shared controls. The approved extension brief and built components are the authority; this is not a new product identity or speculative product brief.

Bookmarks are saved links organized into a tree of folders under three roots, as in Chrome, Edge and Firefox: Bookmarks bar, Other bookmarks and Mobile bookmarks. Live tab groups belong to the visible workspace tab strip, documented in [DesktopLayout](../../app/layouts/DesktopLayout/DESIGN.md). The former Groups popup is retired.

Sources: [tree.ts](tree.ts), [library.ts](library.ts), [BookmarkEditor.tsx](BookmarkEditor.tsx), [BookmarkFolderDialog.tsx](BookmarkFolderDialog.tsx), [BookmarksBar.tsx](BookmarksBar.tsx), [BookmarkRows.tsx](../browser/internal/BookmarkRows.tsx), [BookmarksPage.tsx](../browser/internal/BookmarksPage.tsx), [InternalPageFrame.tsx](../browser/internal/InternalPageFrame.tsx), and shared controls under `src/shared/ui`.

## Colors

Keep the neutral theme tokens live-bound to the application palette. Bright text identifies page and bookmark names; muted text supports URLs, folder attribution, search icons, and empty-state detail. Selected folder filters and hover rows use shared control fills. Folder identity does not receive a tab-group color.

## Typography

Inherit application typography. Use the title role for the page heading, body text for bookmark names and folder controls, and detail text for URLs and folder attribution. Preserve the shared dialog's title and input styles in the editor. Long names, URLs, and folder names truncate within their flexible slots.

## Layout

The page fills its browser content area using the same `CollectionPage`, `CollectionHeading`, and `CollectionSearch` components as Spaces. The page scrolls as one surface, with full-width content, shared responsive padding, and wrapping header actions. Do not restore a separate bordered title bar or a centered 768px content column.

The shared `CollectionFilters` section navigation selects a root: Bookmarks bar, Other bookmarks, and Mobile bookmarks once it has contents. Inside a root, one list shows the open folder's subfolders and links in their shared order, with a breadcrumb above it for the path back up. Folder rows use the shared folder item tone on the glyph only. The folder menu on the section row acts on the open folder; do not repeat its name as a second heading. Searching looks through every folder and adds each match's folder path at the trailing edge. Other bookmarks keeps the former single default folder's ID (`group:bookmarks`) and stored name.

Bookmark and folder editors use the shared content-height dialog, with compact preferred width (384px) from the small breakpoint and viewport-bounded scrolling. The bookmark form orders Name, Address, Folder, and conditional Folder name, followed by validation and actions. Folder pickers list every folder depth first, labeled with its path.

## Elevation & Depth

The library is a flat application page. Use the shared collection heading, row hover fills, and floating-menu treatment. Bookmark editing uses the shared modal dialog surface and backdrop; its interaction differs from the nonmodal tab-group editor.

## Shapes

Retain shared rounded buttons, fields, list rows, menus, and dialogs. Folder filters use the Spaces section-button geometry, with selected state exposed through `aria-pressed`. Do not add a separate card around each bookmark.

## Components

- **Library:** Search matches bookmark names and addresses within the selected folder or all bookmarks. Keep empty-library and no-match messages distinct. Normal activation opens the link in the current view; Command/Ctrl activation and the row menu can open a new tab.
- **Folders:** Folders nest without a fixed depth limit (64 levels, matching native sync) and can be renamed, moved and removed. Removing a folder moves its subfolders and links up into its parent, and the action label says so. The roots cannot be renamed, moved or removed.
- **Import and export:** The header's import and export menu opens the browser import flow and saves the library as the Netscape bookmarks HTML file, with the Bookmarks bar marked as the toolbar folder, so every major browser reads it back.
- **Editor:** Reuse `Field`, `Input`, `Select`, and `Button`. Name has initial focus. New folder reveals its field in place. Save validates the address and displays failures beside the form; Cancel dismisses the draft. Existing bookmarks expose Remove bookmark. Keep the mounted draft independent of external updates.
- **Compatibility:** Existing encrypted v1 `group` and `website` records and IDs remain the wire representation for folders and links. Legacy names are implementation details, not UI labels to restore. New bookmark folders do not create live or saved tab groups. A folder's parent (`parent_id`) and the import dates (`added_at`) are optional fields; folders directly in Other bookmarks store no parent, so their records keep the shape older versions read. Native sync writes those fields only once every active device reports control version 2, and drops them until then.

**The Saved-Link Rule.** A bookmark preserves a saved address; a tab group organizes open workspace tabs. Keep their names, actions, and lifecycles distinct.

## Do's and Don'ts

- **Do** reuse the internal-page frame and shared controls.
- **Do** retain links when removing their folder and state that outcome in the action label.
- **Do** retain accessible labels, pressed states, action names, and inline errors.
- **Don't** restore the saved-website Groups navigator, popup, or destructive folder-removal semantics.
- **Don't** present local tab-group recovery as cross-device bookmark synchronization.

This scoped record does not regenerate root tokens or a root `.impeccable/design.json` sidecar. The [DesktopLayout review record](../../app/layouts/DesktopLayout/DESIGN.md) identifies the synthetic component captures, reviewer scope, and validation boundary for this change. Those previews do not prove a native live signed-in session.
