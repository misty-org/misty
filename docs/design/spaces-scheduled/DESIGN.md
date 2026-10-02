---
name: Misty Spaces and Scheduled
description: Shared monochrome workspaces for collections and recurring tasks.
colors:
  workspace: "var(--misty-theme-workspace)"
  sidebar: "var(--misty-theme-sidebar)"
  card: "var(--misty-theme-card)"
  border: "var(--misty-theme-border)"
  text: "var(--misty-theme-text)"
  text-bright: "var(--misty-theme-text-bright)"
  text-muted: "var(--misty-theme-text-muted)"
typography:
  title:
    fontSize: "24px"
    fontWeight: 500
    lineHeight: "32px"
  sidebar-title:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontSize: "14px"
    lineHeight: "20px"
  label:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
rounded:
  card: "12px"
  control: "6px"
  island: "8px"
  suggestion: "16px"
spacing:
  sidebar: "12px"
  content: "20px"
  section: "24px"
  desktop-gutter: "48px"
components:
  workspace-sidebar:
    backgroundColor: "{colors.sidebar}"
    width: "240px"
    padding: "{spacing.sidebar}"
  collection-search:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.island}"
    padding: "8px 12px"
  collection-tile:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "16px"
    height: "82px"
  workspace-suggestion:
    rounded: "{rounded.suggestion}"
    padding: "20px"
---

# Design System: Spaces and Scheduled

## Overview

**Mode: Operate.** This scoped record describes the implemented Spaces overview, Journal notes and drawings collections, Space rail, and Scheduled workspace. The user approved the screenshot direction and requested production implementation using Misty's shared components and styles exclusively. [PRODUCT.md](PRODUCT.md) records that scope and its product constraints.

The visual direction is a quiet monochrome workspace: named navigation, aligned collection rows, restrained metadata, and sparse copy. Production composition is owned by [CollectionWorkspace.tsx](../../../src/shared/ui/patterns/CollectionWorkspace.tsx), feature components, and the existing shared theme. This document does not replace Misty's root design authority.

Historical `mockups/spaces.jpg`, `mockups/journal.jpg`, and `mockups/scheduled.jpg` are approved composition references with synthetic data. Their `mockups/preview.tsx` and bespoke `mockups/preview.css` remain isolated preview artifacts, not production styling or proof of working account behavior. Their earlier widths and radii are superseded here by the implemented shared patterns.

## Colors

Use the existing black, white, and gray semantic theme. Workspace, sidebar, and card tones establish regions; bright text marks headings, muted text carries metadata, and borders separate rows. The frontmatter references live theme variables from `src/styles/styles.css` rather than introducing a second palette.

**The Shared Theme Rule.** Shared controls own hover, selection, focus, and disabled treatment. Do not introduce colored status dots, tinted selections, accent focus rings, or surface-specific palette overrides. Status must remain understandable through text and icons.

## Typography

Inherit the application font and the shared controls' typography. Collection titles use the title role; welcome titles use 20px medium text; sidebar headings use the sidebar-title role. Body content and navigation remain compact, with the label role reserved for muted section labels and metadata. Long content titles wrap or truncate within their available space. Keep helper copy short and functional.

## Layout

The shared sidebar uses the frontmatter width and padding with independent scrolling. In a Space, the current name and New action precede a vertical labeled list of All, Chat, Planner, Journal, and Library. The active Chat tool retains its conversation list; other tools show recent content from this Space when available. Members and Usage share a shared island below. Trash opens the current Space’s existing Library Recently Deleted collection, including its unlock and restore flow; it is hidden without Library access. Journal deletion remains permanent. Permission filtering applies to links, shortcuts, and recent content. There is no second Spaces list: the main navigator owns Space switching.

Collections use a wrapping heading and action row, tool shortcuts where relevant, filters, and the shared collection table or grid. The content starts with the content inset and section gap; desktop gutters are 48px. Collection tiles have an 80px minimum-height inner control and an 82px outer height including borders; collection rows are 52px high. The collection grid expands from one column to two at 320px and four at 760px of collection width; the category table column appears from 500px. Search and creation actions wrap on narrow surfaces; filters collapse into a dropdown on mobile. Space navigation on mobile uses the shared Sheet.

Scheduled has a shared task roster, a welcome state when no task is selected, and the existing agent conversation when one is selected. The welcome content is capped at 736px with suggestion columns from 560px of welcome width. Upcoming tasks are ordered by next run; Paused tasks form a separate group. The desktop roster appears from 701px of Scheduled width. Selected tasks show a 288px details region from 1121px; narrower views use shared Sheets for task navigation and details.

## Elevation & Depth

Keep workspaces and collections flat, using existing surface tones and thin borders. Shared Cards have no shadow. Scheduled details use the existing Card inside a padded region. Menus, popovers, dialogs, and mobile disclosures inherit Misty's shared overlay treatment, focus management, and dismissal behavior.

## Shapes

Cards use the shared card radius and suggestions use the shared 16px radius. Buttons, inputs, select triggers, and navigation items use the standard 6px shared radius, matching File Explorer. InputGroup search containers and NavIsland groups use the standard 8px radius. Keep the outlined filter, view, management, and task-action islands; do not override them with pill or circular corners. Space links use NavIslandItem. Suggestions use the shared outline Button with a dashed border. Collection rows stay flat, with small outlined icon containers. The temporary capsule shape APIs have been removed.

## Components

- **Shared composition:** `WorkspaceSidebar`, `WorkspaceSidebarHeading`, `WorkspaceSectionLabel`, `CollectionPage`, `CollectionHeading`, `CollectionSearch`, `CollectionFilters`, `CollectionGrid`, `CollectionTile`, `CollectionItems`, `WorkspaceWelcome`, and `WorkspaceSuggestion` live in `CollectionWorkspace.tsx`. They compose existing Button, Input, Card, Table, ContextMenu, NavIsland, and OptionSelect primitives. The shared toolbar includes `CollectionViewToggle`, with separate islands for view choices and outlined radio choices for sort; sort and view controls are disabled for empty collections. Button and NavIsland hover changes use `transition-none`. NavigationTree no longer forces GPU promotion.
- **Spaces overview:** predefined tool shortcuts and authorized recent content from existing services. Rows open their corresponding tools. Library shortcuts require `library.view`; Chat and Planner retain their own permission gates.
- **Journal:** distinct Pins, Notes, and Drawings destinations use the collection composition; the duplicate Recent entry is removed. Preserve creation, editing, pinning, deletion, collaboration, item menus, and list/grid controls where applicable.
- **Scheduled:** welcome suggestions prefill the existing task editor for review. `ScheduledPage` loads agents directly; the editor resolves its default after late agent arrival and exposes retry on loading failure. The previously blank agent field and disabled Create action were corrected and verified in live Misty. Status filtering uses a dropdown. The roster, assigned-agent conversation, run controls, editing, deletion confirmation, and unsent-draft guard remain integrated with the existing services. Shared Sheets replace bespoke responsive overlay styling; `scheduledWorkspace.css` has been removed.
- **Documentation sidecar:** `.impeccable/design.json` in this directory contains isolated documentation snippets extracted from the shared primitives. Those snippets illustrate the system; production continues to import the shared React components.

Current evidence is `.impeccable/review/spaces-parity/comparison.html`, a source-labelled side-by-side comparison. Five production-component captures cover Spaces and Journal desktop (1451×898), Scheduled desktop (1443×897), and Spaces and Scheduled mobile (390×844). Three live Misty captures are `live-spaces.png`, `live-scheduled.png`, and `live-scheduled-editor.png`. Fixture captures use illustrative data. Supplied Codex screenshots provide the reference: computer-use safety blocked `com.openai.codex`, so the comparison does not establish live Codex parity.

The fresh review disposition is SHIP for screenshot fidelity and inspected code only. Live checks covered New Note, New Task, Upload, Members, Usage, Scheduled status filtering, and a starter editor with an agent loaded and Create enabled. QA saved no schedule and uploaded no file; backend mutation coverage uses component tests and mocked APIs. Final checks passed after the mobile-dropdown adjustment: 68 tests across 15 files, lint, formatting, typecheck, and the desktop production build. Earlier `.impeccable/review/spaces-shared/` captures are historical evidence, not the current geometry or proof of all actions.

## Do's and Don'ts

- Do use Misty's shared controls, collection patterns, theme, and mobile Sheets.
- Do preserve sparse copy, named navigation, permissions, and real feature behavior.
- Do keep Space switching in the main navigator.
- Don't create a second Spaces list in the Space rail.
- Don't promote historical preview CSS or fixture data into production authority.
- Don't introduce a new visual theme or duplicate shared component styling in feature CSS.

## Capsule and Trash follow-up

Historical capsule captures are `.impeccable/review/spaces-capsules/`: desktop and mobile Spaces and Scheduled, plus the Scheduled editor and details. These use production components with sample data. The live Misty window showed Sign In during this pass. Trash routing and permission checks were verified in component tests; no live restore was performed.

The File Explorer rounding correction is captured in `.impeccable/review/spaces-rounding/`. These production-component fixtures confirm standard shared corner radii while retaining the grouped islands and Trash.
