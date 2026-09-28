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
    backgroundColor: "{colors.workspace}"
    width: "208px"
---

# Design System: Space navigation

## Overview

This document applies only to `SpaceWorkspaceRail` and the section/management navigation it composes. Other Space surfaces retain their existing design authority. The approved extension keeps a full named sidebar beside the compact [global navigator](../../../app/layouts/DesktopLayout/DESIGN.md), using Misty's incumbent theme, typography, and controls.

Sources: [SpaceWorkspaceRail.tsx](SpaceWorkspaceRail.tsx), [SpaceSectionNavigation.tsx](SpaceSectionNavigation.tsx), [SpaceManagementNavigation.tsx](SpaceManagementNavigation.tsx), [SpaceSidebarLink.tsx](spacePanel/SpaceSidebarLink.tsx), and shared navigation styles.

## Colors

Use the workspace background and shared right border to separate navigation from content. Muted labels become bright on hover or selection, with the existing row fill. Preserve unread badges as activity indicators, not a new navigation palette.

## Typography

Inherit application and shared navigation typography. Keep section names and Members/Usage visibly rendered. Long text truncates within its available width while retaining accessible text. Section links keep shared medium-weight navigation styling; management actions retain shared button typography.

## Layout

The sidebar keeps its frontmatter width and fills its owning Space view vertically, with horizontal insets (8px) and independent vertical scrolling. The Space's name comes first, with a "…" menu for leaving or deleting it. Switching Spaces happens in the global navigator's Space stack, not here. Below the name, Chat, Planner, Journal, and Library form one icon strip of equal cells (permissions still filter them). The rest of the sidebar belongs to the active tool's own list — for Chat, every conversation: channels, direct messages, then connected accounts ([SpaceChatSidebar.tsx](../chat/sidebar/SpaceChatSidebar.tsx)). Members and Usage stack at the foot.

**The Named-Space Rule.** Global icon navigation and named Space navigation coexist. The global navigator's auto-hide setting does not hide Space section or management labels.

## Elevation & Depth

Keep the sidebar flat, separated by its border and shared hover/selection fills. The switcher and management popovers use the established overlay treatment. Navigation failures use the existing local alert surface.

## Shapes

Retain shared navigation rows, buttons, icon sizing, and focus treatment. Icons supplement visible names. Keep the sidebar as one continuous surface without a card around each destination.

## Components

- **Header:** Names the active Space; the "…" menu holds Leave or Delete. Creating Spaces lives in the global Space stack.
- **Tool strip:** Icon cells with tooltips and unread dots. Preserve permission filtering, activity badges, `aria-current`, and remembered Planner/Journal destinations. Modified activation retains normal link behavior. Section navigation updates only its owning tab, including split layouts.
- **Management:** `SpaceWorkspaceRail` explicitly uses named Members and Usage controls. Their popovers remain reachable through full-width ghost buttons with icons and visible labels. The component's compact variant is not the presentation chosen for this sidebar.
- **Errors:** Keep the current view and show the local alert when a section cannot preload, allowing a retry.

## Do's and Don'ts

- **Do** keep work destinations above and management controls at the foot.
- **Do** preserve names, active state, unread information, and keyboard focus.
- **Don't** turn this sidebar into a second global icon rail.
- **Don't** infer a new Settings destination from the stale test expectation; this change retains the current management API.

Evidence: [space-desktop.png](../../../../.impeccable/review/tab-groups/space-desktop.png) is a labeled synthetic preview using actual components, not native live-session proof. The full review covered the named sidebar; the final accepted fix concerned the tab-group editor. The [DesktopLayout record](../../../app/layouts/DesktopLayout/DESIGN.md) states validation scope and the known pre-existing SpaceWorkspaceRail test failure. This scoped document does not regenerate root tokens or a root design sidecar.
