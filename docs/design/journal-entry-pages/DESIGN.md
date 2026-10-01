---
name: Misty Journal-style entry pages
description: Desktop collection entries using Misty's shared monochrome controls.
colors:
  workspace: "var(--misty-theme-workspace)"
  card: "var(--misty-theme-card)"
  border: "var(--misty-theme-border)"
  hover: "var(--misty-theme-hover)"
  active: "var(--misty-theme-active)"
  text: "var(--misty-theme-text)"
  bright: "var(--misty-theme-text-bright)"
  muted: "var(--misty-theme-text-muted)"
  background: "var(--misty-theme-bg)"
typography:
  heading:
    fontSize: "24px"
    fontWeight: 500
    lineHeight: "32px"
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  metadata:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  control: "6px"
  island: "8px"
  card: "12px"
  capsule: "9999px"
spacing:
  small: "4px"
  compact: "8px"
  control-gap: "12px"
  card-inset: "16px"
  section: "24px"
  page-block: "32px"
  page-inline: "48px"
components:
  button-primary:
    backgroundColor: "{colors.bright}"
    textColor: "{colors.background}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 10px"
  collection-search:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.island}"
    padding: "8px 12px"
  section-island:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted}"
    rounded: "{rounded.island}"
    padding: "2px"
  utility-island:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted}"
    rounded: "{rounded.capsule}"
    padding: "2px"
  collection-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Misty Journal-style entry pages

## Overview

**Creative North Star: "Journal-style entry, shared Misty controls"**

Library, Chat, Planner, and Agents share a quiet desktop collection grammar: choose a section, scan or search its items, then open or create the specific kind of item. This scoped record describes production entry components and their supporting desktop shells. It does not replace global navigation, Settings, or the detailed conversation/editor systems.

Source authority is `src/shared/ui/patterns/CollectionWorkspace.tsx`, shared `Button` and `NavIsland`, `src/styles/styles.css`, and the feature entry components `LibraryEntryHeader`, `SpaceLibraryItems`, `SpaceChatEntry`, `PlannerCollection`, and `AgentCollection`. The latest shared controls and metadata treatments take precedence over historical screenshots. Approved direction is recorded in [PRODUCT.md](../../../.impeccable/review/journal-entry-implementation/PRODUCT.md).

Current captures in `.impeccable/review/journal-entry-implementation/` render actual production components with deterministic fixture data at desktop width, not a live backend. The implementation pass reports 96 focused tests across 13 suites, desktop build, typecheck, and scoped lint passing. Historical mobile mockups are superseded; no mobile shell behavior or viewport verification is claimed.

**Key Characteristics:**

- One collection heading, search, specific action, and shared section controls.
- Monochrome UI chrome with existing cloud identity artwork retained.
- Creator metadata and rounded interaction fills on shared rows.
- Modest text controls and capsule-shaped collection icon utilities.
- Desktop shells that preserve existing editor, permission, and draft behavior.

## Colors

Neutral contrast supplies emphasis, depth, and state. The frontmatter binds to the live semantic theme rather than freezing a duplicate palette.

### Primary

Bright text supplies the filled creation action against the background-colored label or icon.

### Neutral

Workspace is the open page; card supports fields and islands; border separates controls and table headings. Text carries names, muted carries metadata, and hover/active supplies shared neutral interaction feedback.

**The Monochrome Chrome Rule.** Use words, icons, and contrast for status; do not introduce colored dots, tinted selections, or accent focus rings. Existing cloud identity artwork is the established exception.

## Typography

Inherit the application font. The compact hierarchy uses the heading role for page titles, body for names and controls, and metadata for dates and secondary card information. List titles may wrap to two lines. Shared grid titles keep one line with an end fade and their complete title available. Creator metadata truncates with its full attribution available where provided.

## Layout

`CollectionPage` fills its workspace with an independently scrolling column, page-inline and page-block insets, and section gaps. The heading pairs its title with search and a specific action. Section tabs appear below it; filter and view utility islands sit at the opposite side. Internal flex wrapping handles available desktop space without changing the navigation model.

List tables keep their metadata columns and permit horizontal overflow. Shared grids use auto-filled columns with a minimum width of 180px and 12px gaps. Shared collection cards are 256px tall; Library retains its media-oriented thumbnail composition and scale control.

**The Desktop Shell Rule.** Space navigation remains present; Agents opens a collection before its conversation; Scheduled retains its task roster and optional inspector. These shells do not switch to mobile Sheets or hide columns at breakpoints. Explicit creation, settings, and connection dialogs retain their existing purpose.

## Elevation & Depth

Pages and shared collection cards are flat. Tonal surfaces, hairline boundaries, and neutral row fills establish separation. Entry search and primary collection controls do not add decorative shadows or motion. Menus and popovers keep shared overlay treatment.

## Shapes

Text buttons retain the control radius; search and text navigation islands retain the island radius. Cards use the card radius. Shared list rows round the outer cell edges and leave a small gap between rows.

**The Standalone Button Rule.** Shared section and utility controls retain semantic grouping through NavIsland, but the group has no outer fill, border, rounding, or inset. Individual buttons own hover, selected, and focus states. This supersedes the previous capsule-container direction.

## Components

- **Heading and action:** Use `CollectionHeading` and `CollectionSearch`. Actions name the object: Upload files, New album, New chat, New task, or New agent as appropriate. Shared disabled and busy states reflect actual availability.
- **Sections and utilities:** Use `CollectionFilters`, `NavIsland`, and `CollectionViewToggle`. Text sections expose selected state; icon utilities retain accessible labels and shared monochrome keyboard focus.
- **Rows and cards:** Use `CollectionItems` for the common list/grid grammar. Name, category/status, available creator attribution, and last activity remain distinct. Row menus reveal on hover, keyboard focus within the row, and open-menu state. Row activation must not consume nested action clicks. Library list icons use `FileNameIcon` so file type remains semantic.
- **Library:** Files, Favorites, Albums, and Trash are direct tabs; additional sections remain in the existing menu. Library owns Trash and its restore flow. Preserve unlock, edit permission, upload, sort, filter, selection, and provenance behavior. Attribution is Added by, with contributed/uploaded details where available.
- **Chat and Planner:** Root entries lead into existing conversations and detailed editors. Preserve permission filtering, specific creation flows, deep links, error/retry states, and truthful creator data; do not turn unknown dates or creators into invented values.
- **Agents:** Agents, Conversations, Activity, and Scheduled form the full-width entry. Scheduled opens the existing task workspace and editor within Agents; legacy links and saved tabs preserve their task selection. Status comes from actual agent/runtime state, including loading and unavailable states. Selected conversations retain the overview, composer, account context, and draft guards; the collection does not grant permissions or start work on its own.
- **Space rail:** Keep labeled destinations and Members/Usage. There is no generic New/New item action or Trash destination in the rail. Tool-specific creation and the Library Trash tab own those flows.

## Do's and Don'ts

### Do:

- Do reuse the latest shared collection, button, and navigation components.
- Do preserve keyboard focus, permissions, account boundaries, draft guards, and retry behavior.
- Do retain creator metadata, semantic file icons, and hover/focus menu access.
- Do keep desktop navigation and metadata visible without mobile shell switching.

### Don't:

- Don't add a new palette, colored status chrome, or decorative emphasis.
- Don't restore generic Space creation controls or a rail-level Trash destination.
- Don't flatten the distinction between text controls and individual icon utilities.
- Don't treat fixture screenshots or mocked tests as live backend or native integration verification.
