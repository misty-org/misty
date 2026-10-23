---
name: Misty desktop shell
description: The window's tab sidebar, panes and tab groups.
---

# Desktop shell

This folder draws one Misty window: the tab sidebar, the Space bar above the pages, the panes, and the tab groups in the sidebar. The palette is the black, white and gray one in AGENTS.md; tab groups and the Space's window color are the only colors here.

Sources: [index.tsx](index.tsx), [WorkspaceCanvas.tsx](WorkspaceCanvas.tsx), [WorkspaceTabStrip.tsx](WorkspaceTabStrip.tsx), [MistyTabGroups.tsx](MistyTabGroups.tsx), [TabGroupEditor.tsx](TabGroupEditor.tsx), [dockingGeometry.ts](dockingGeometry.ts), [docking.css](docking.css), [tabGroups.css](tabGroups.css) and [tabGroups.ts](../../../features/workspace/tabGroups.ts).

## Layout

Tabs always sit in the tab sidebar, on the left or the right of the window. There is no horizontal tab strip; layouts saved with tabs on the top or bottom open with tabs on the left. `dockingGeometry.ts` owns the shell: one titlebar row, the content spanning the window, and an even pane margin with rounded corners on every edge. Do not add orientation-specific borders or spacing outside it.

The sidebar is a card on the window chrome. Its head row shares the band of the native window buttons and holds the sidebar toggle and back, forward and reload. Below it come the focused browser page's address field, the favorites grid, the sticky New Tab row and the tab list, whose edges fade while more tabs sit beyond them. The foot row holds Downloads on the left; the account row is its own container beneath the card. Collapsed, the sidebar's width animates to nothing and the card slides over the page when revealed. The outer edge resizes it.

`useMergedTitlebar` reserves the native button overlap only where no sidebar holds the window controls (focus mode, which hides the sidebar and the Space bar; a browser page then shows its own toolbar row). `useDockingTransition` keeps mounted panes in place while the shell moves and shares its 300ms ease-in-out timeline; native pages resume once the motion settles, and reduced motion skips it.

A tab split into panes shows each pane as its own rounded container with a gap between them; a single pane shares the page's outline. There is no bookmarks bar.

## Tab rows

Vertical tab rows are rounded, with a soft wash on hover and a slightly stronger one on the selected tab, never a bordered card. The close button appears at the row's right edge on hover or focus (always on touch), and the title fades out before it. A playing tab's speaker sits right after its favicon. Pane chips step aside while the close button shows.

## Tab groups

A group's color is its label chip, filled with one of nine colors (an unnamed group is just a color dot). Member tabs look like any other tab and hang beneath the chip on the shared `TreeBranch` trunk, drawn in the group's color. Hover, focus and the rest of the sidebar stay monochrome.

- Clicking the chip collapses or expands the group; collapsing keeps the members' pages running. Selecting a hidden member expands its group.
- Right-clicking the chip (or the keyboard context action) opens the editor: a name field, the color swatches with a checkmark on the selected one, New tab in group, Move group to new window, Ungroup, Close group (kept to reopen later) and, set apart, Delete group. Name and color apply as they change.
- A tab's context menu adds it to a new or existing group, removes it from its group, and reopens saved groups.
- Dragging a group's chip moves the whole group.
- Groups and saved groups are device-local workspace data; private layouts are never saved.
