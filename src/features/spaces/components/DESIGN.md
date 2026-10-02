---
name: Misty named Space navigation
description: The labeled sidebar for work and management within the current Space.
colors:
  workspace: "var(--misty-theme-workspace)"
  border: "var(--misty-theme-border)"
  text-bright: "var(--misty-theme-text-bright)"
  text-muted: "var(--misty-theme-text-muted)"
components:
  space-navigation:
    backgroundColor: "var(--misty-theme-sidebar)"
    width: "224px"
---

# Design System: Space navigation

## Overview

This document applies only to `SpaceWorkspaceRail` and the section/management navigation it composes. Other Space surfaces retain their existing design authority. The approved extension keeps a full named sidebar beside the compact [global navigator](../../../app/layouts/DesktopLayout/DESIGN.md), using Misty's incumbent theme, typography, and controls.

Sources: [SpaceWorkspaceRail.tsx](SpaceWorkspaceRail.tsx), [SpaceSectionNavigation.tsx](SpaceSectionNavigation.tsx), [SpaceManagementNavigation.tsx](SpaceManagementNavigation.tsx), [SpaceSidebarLink.tsx](spacePanel/SpaceSidebarLink.tsx), and shared navigation styles.

## Colors

Use the shared sidebar background and right border to separate navigation from content. Muted labels become bright on hover or selection, with the existing row fill. Preserve unread badges as activity indicators, not a new navigation palette.

## Typography

Inherit application and shared navigation typography. The Space heading uses 14px text; section links and Members/Usage use 13px labels. Keep names visibly rendered. Long text truncates within its available width while retaining accessible text. Section links keep shared medium-weight navigation styling; management actions retain shared button typography.

## Layout

The sidebar uses the shared `WorkspaceSidebar` width (224px) and padding (8px), with independent vertical scrolling. Section links are 32px tall and retain a 44px minimum target for coarse pointers. The Space's name and menu come first, followed by a vertical labeled list: All, Chat, Planner, Journal, and Library, filtered by permissions. Switching Spaces happens in the global navigator, never in a second Spaces list here. Chat retains its conversations: channels, direct messages, then connected accounts ([SpaceChatSidebar.tsx](../chat/sidebar/SpaceChatSidebar.tsx)). Other tools show recent content from the current Space. Journal exposes distinct Pins, Notes, and Drawings destinations without a duplicate Recent entry. Members and Usage remain below. The rail remains visible in the desktop shell; it has no mobile Sheet or breakpoint-based replacement. Root Chat and Planner open collection entry pages; deep conversations and editors retain their existing layouts.

**The Named-Space Rule.** Global icon navigation and named Space navigation coexist. The global navigator's auto-hide setting does not hide Space section or management labels.

## Elevation & Depth

Keep the sidebar flat, separated by its border and shared hover/selection fills. The header menu and management popovers use the established overlay treatment. Navigation failures use the existing local alert surface.

## Shapes

Retain shared navigation rows, buttons, icon sizing, and focus treatment. Icons supplement visible names. Keep the sidebar as one continuous surface without a card around each destination.

## Components

- **Header:** Names the active Space; the "…" menu holds Leave or Delete. Creating Spaces lives in the global Space stack.
- **Tool navigation:** Visible labels and Lucide icons, with All opening the overview. Preserve permission filtering, activity badges, `aria-current`, and remembered Planner/Journal destinations. Modified activation retains normal link behavior. Section navigation updates only its owning tab, including split layouts.
- **Management:** `SpaceWorkspaceRail` explicitly uses named Members and Usage controls. Their popovers remain reachable through full-width ghost buttons with icons and visible labels. The component's compact variant is not the presentation chosen for this sidebar.
- **Errors:** Keep the current view and show the local alert when a section cannot preload, allowing a retry.

## Do's and Don'ts

- **Do** keep work destinations above and management controls at the foot.
- **Do** preserve names, active state, unread information, and keyboard focus.
- **Don't** turn this sidebar into a second global icon rail.
- **Don't** infer a new Settings destination from the stale test expectation; this change retains the current management API.

Current direction and evidence: [Spaces and Scheduled DESIGN.md](../../../../docs/design/spaces-scheduled/DESIGN.md). The source-labelled comparison in `.impeccable/review/spaces-parity/comparison.html` supersedes earlier rail captures. It separates supplied Codex references, production-component fixtures, and live Misty captures; live Codex inspection was blocked by computer-use safety. Screenshot fidelity and inspected code received SHIP, without establishing all live actions. This scoped record does not regenerate root tokens or a root design sidecar.

The current rail uses shared `NavIslandItem` links and a Members/Usage island. It contains neither a generic New/New item action nor a Trash destination. Creation belongs to each tool’s specific entry action. Library owns its Trash tab at `/spaces/:id/library?collection=deleted`; permission checks, unlock requirements, and restoration behavior remain authoritative. Trash is omitted from Recents.

Use standard shared modest radii for text controls and navigation islands. The latest shared collection filter/view utility capsules are intentional; do not revert them from historical screenshots. Current desktop entry authority is [Journal entry pages](../../../../docs/design/journal-entry-pages/DESIGN.md).

The latest user direction removes outer button-group containers everywhere shared `NavIsland` is used. Members/Usage and collection controls retain individual buttons, labels, selection and focus, without a group fill or border. This supersedes the capsule/island container direction.

### October 1 header alignment

The Space rail keeps its compact 8px horizontal inset and shares the collection content’s 12px top inset. Both headers use a 36px first row, aligning the Space identity and page title on one horizontal center line. The page title retains that first-row height when its actions wrap. Members and Usage are compact shared icon buttons beside the Space title, opening their existing popovers below. Collection searches match primary actions at 36px tall, with 16px horizontal padding and the shared modest radius. The three-dot title menu and bottom management rows are removed. No additional button container or mobile behavior is introduced.

### Collection filters

Every Spaces entry collection has a shared filter dropdown. Filters refine the selected tab: All uses item type; Chat uses creator; Journal uses access and activity dates; Planner uses task status/priority, event timing, or roadmap status; Library uses media type and sorting. Selections use checkmarks, active triggers use monochrome contrast, and Reset filters restores defaults. Task filters and ordering are applied by the paginated API. A short shared vertical separator divides filter/utility controls from layout controls. Visible section tabs are never duplicated in the menu.

### Collection sections — October 1, 2026

Every Space collection has an All section. Space overview includes collaborators’ items alongside Yours, Suggested and Favorites. Journal All combines notes and drawings; Pinned combines both kinds using their existing pin identities. Planner All combines tasks, upcoming agenda entries and roadmaps. Library’s full file collection is labeled All, alongside Favorites, Albums and Trash. Chat retains its existing All section.

Users drag the section buttons directly to reorder them, or focus a button and press Alt+Shift+Left/Right. Reordering never selects the moved section. Keep the controls visually quiet: no permanent drag handles or instructional panels. Order is an account preference per collection, shared across Spaces and devices, with the same Journal order on both note and drawing routes. Preserve temporarily unavailable sections and append newly introduced sections. Client and server validate the preference through the account settings registry.
