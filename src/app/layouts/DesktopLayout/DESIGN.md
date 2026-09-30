---
name: Misty tab groups and global navigation
description: Visible workspace tab groups and compact global navigation within Misty's existing desktop shell.
colors:
  workspace: "var(--misty-theme-workspace)"
  surface: "var(--misty-theme-card)"
  border: "var(--misty-theme-border)"
  text: "var(--misty-theme-text)"
  text-bright: "var(--misty-theme-text-bright)"
  text-muted: "var(--misty-theme-text-muted)"
  group-label-text: "#202124"
  group-gray: "#a6a6ad"
  group-blue: "#8ab4f8"
  group-red: "#f28b82"
  group-yellow: "#fdd663"
  group-green: "#81c995"
  group-pink: "#ff8bcb"
  group-purple: "#c58af9"
  group-cyan: "#78d9ec"
  group-orange: "#fcad70"
typography:
  navigation:
    fontSize: "14px"
    fontWeight: 500
  tab:
    fontSize: "12px"
  group-label:
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "18px"
rounded:
  group-label: "4px"
  group-active-outline: "7px"
components:
  group-label:
    typography: "{typography.group-label}"
    rounded: "{rounded.group-label}"
    padding: "3px 8px"
  global-icon-rail:
    backgroundColor: "{colors.workspace}"
    width: "54px"
---

# Design System: Tab groups and global navigation

## Overview

This document covers visible tab grouping and the global navigation icon rail. It extends the existing shell without redefining unrelated DesktopLayout surfaces. The approved extension brief and implementation are the authority. Retain Misty's charcoal and cream theme, shared application typography, and established controls. No new brand, concept composition, or root product brief was introduced.

Groups organize visible Misty layout tabs, including Browser, Files, Agents, and split layouts. Bookmarks have their own [library](../../../features/bookmarks/DESIGN.md). The compact global navigator and [named Space navigation](../../../features/spaces/components/DESIGN.md) have distinct roles.

Sources: [MistyTabGroups.tsx](MistyTabGroups.tsx), [WorkspaceLayoutTabs.tsx](WorkspaceLayoutTabs.tsx), [tabGroups.css](tabGroups.css), [GlobalNavigator.tsx](GlobalNavigator.tsx), [docking.css](docking.css), [navigatorMode.ts](../../../features/app-shell/navigatorMode.ts), and [tabGroups.ts](../../../features/workspace/tabGroups.ts).

## Colors

The shell remains neutral. The nine group colors identify membership through the label, dot, and connecting marker. Use one selected color throughout each group. Active tabs retain the shared card fill and bright text; group color does not replace selection styling or fill the workspace.

**The Membership Accent Rule.** Color connects labels and members; names, counts, and expanded state keep the grouping understandable without color.

## Typography

Inherit application typography without a new display face. Global navigation uses the navigation role, tabs use the tab role, and group labels use the compact semibold group-label role. Names truncate within the strip. Empty names display Unnamed group. Keep shared body and input styles in the group editor.

## Layout

The global navigator is 54px wide on either side and 38px tall on the top or bottom, with equal 10px horizontal outer gutters. Its modes are pinned and auto-hide. Auto-hide reserves no track and reveals the same mounted rail over the workspace; focus and open menus keep it visible. Settings → Layout and the keyboard shortcut control auto-hide. There is no titlebar toggle. Every tile is 34×34px around an 18px glyph; Space and Profile identities are 20px. Preserve accessible names on every tile.

All 16 supported navigation/tab combinations use `dockingGeometry.ts`: stable grid tracks, native titlebar reservations, tab insets and pane seams. Left navigation with top tabs is the visual reference. The other layouts transpose the same tile, gap, tray, footer and tab rules. Horizontal strips are 38px tall; every tab row is 28px, including vertical strips. Side strips use up to 200px (bounded to 35% in narrow windows). New tab follows the tabs on every edge. Do not add orientation-specific borders or spacing patches outside this contract.

Layout settings expose Navigation position and Tabs position as the shared segmented pill selectors, without built-in or saved presets. Navigation and tabs can share any edge: navigation sits against the window edge, with tabs immediately inside. Top navigation shares the native titlebar. When neither navigation nor tabs is on top, the existing page toolbar reaches the window top; `useMergedTitlebar` reserves only the native button overlap in each topmost pane. A page without a toolbar uses its title in that space. Lower split panes retain their normal spacing.

`useDockingTransition` preserves mounted panes and shares the shell's 300ms ease-in-out timeline. Native webviews resume when actual track and relocation animations finish; reduced motion skips relocation. Auto-hide overlays do not reflow content. Shared overlay placement points menus, popovers and tooltips inward; Windows titlebar controls retain downward placement. Escape from revealed navigation returns focus to its edge control.

Use the approved black, white and gray shell palette from AGENTS.md. Historical accent guidance below does not authorize new colored shell controls.

Search, Activity, and Sync sit in the fixed footer, in that order directly above Settings and Profile. These five utility controls never show window-edge indicators, including when hovered, focused, active or open. Edge indicators belong only to navigation destinations. The Misty menu stays at the top, and destinations scroll independently between the header and footer.

Horizontal strips are (38px) tall. Group labels precede a contiguous block of tabs, with a continuous 2px color line from the label through the members, rising around the active tab’s top and sides. The scroll area reserves vertical clearance for that line. Horizontal tabs retain flexible widths bounded between (80px) and (160px).

Left/right strips retain their width (200px). The group label sits above members, which indent (8px) and use a left color marker (2px). The same state and actions apply in every supported strip position. Keep overflow within the tab list.

The group editor anchors to its header as a nonmodal popover with preferred width (288px), shared padding (12px), and viewport-bounded vertical scrolling. Its form orders Group name, Color, group actions, errors, and Done. All nine colors fit in one row in the reviewed layout.

**The Navigation Scope Rule.** The icon rail never collapses the Space sidebar; Space sections and management controls retain visible names.

## Elevation & Depth

The shell uses neutral surface layering, borders, and the existing active-tab shadow. Menus and the group editor inherit shared popup surfaces, edges, shadows, and opening/closing motion. The group editor has no modal backdrop. Global-navigation hover is a paint change, matching incumbent rules that prevent icon movement during hover.

## Shapes

Group labels use a small rounded fill in their selected color with dark, contrasting text. Circular dots identify groups in menus. Circular color targets (24px) have a cream selection outline and separately visible keyboard-focus outline. Retain shared rounded tabs, buttons, fields, and popovers.

## Components

- **Group header:** Clicking toggles collapse. Its accessible name includes group name, count, and collapsed state; `aria-expanded` follows that state. Only the group name is visible in both states; the count stays in the accessible name and tooltip. Right-click, the Context Menu key, or Shift+F10 opens the configuration popover. There is no separate edit button. Dragging moves the whole contiguous group; preserve keyboard reordering.
- **Membership:** Tab context menus offer New group, existing open groups, and Remove from group for a member. Membership applies to the whole layout tab, including its split tree. Selecting a hidden member expands its group. Collapse keeps running views alive.
- **Editor:** Initially focus the name field. Named color buttons expose `aria-pressed`. Save name/color on Done or dismissal; return focus to the group header on close. Escape dismissal and focus return were verified in the synthetic preview. Keep New tab in group, Move group to new window, Ungroup tabs, Close and save group, and Delete group and close tabs as distinct actions.
- **Close/restore:** Ungroup leaves members open. Close and save records restorable members before closing live tabs; delete removes the group and closes members. Check every member for unfinished changes before a closing mutation, with a local error when blocked. Private layouts are excluded from saved groups.
- **Tab groups context menu:** Right-click a tab to add it to a group or reopen a saved group. There is no dedicated tab-groups toolbar icon. Submenus render in a portal to escape the parent menu’s scrolling bounds. Creating a group hands focus from the closing context menu to the group editor. Group configuration is accessed through the header’s context action.
- **Global navigation:** Browser, Agents, Files, and Spaces remain destinations, with server/search/activity controls above. The bottom group is Settings, Help, then Profile, which always comes last. Space tools retain their named sidebar.
- **Persistence:** Group metadata and saved groups are device-local, account-bound workspace/recovery data. Native cross-device tab-group sync is not implemented. Existing encrypted v1 bookmark records remain folders/links. Migration creates closed saved groups once from legacy saved-website groups without opening all their pages; new bookmark folders do not become tab groups. The [implementation plan](../../../../docs/plans/chrome-style-tab-groups.md) separates this boundary from future native sync work.

## Do's and Don'ts

- **Do** preserve label/member relationships in horizontal and vertical strips.
- **Do** retain non-color cues, keyboard controls, visible focus, and shared popup styling.
- **Do** distinguish collapse, ungroup, close/save, and delete in labels and behavior.
- **Don't** restore a centered modal group editor or wrap swatches in a separate card.
- **Don't** compress Space navigation into a second icon rail.
- **Don't** describe local saved-group recovery as native cross-device sync.

Review evidence: [tab-groups captures](../../../../.impeccable/review/tab-groups) contains `desktop.png`, `compact.png`, `space-desktop.png`, `vertical.png`, and `editor.png`. These are labeled synthetic previews using actual product components. They do not prove a native live signed-in session, native webview behavior, or cross-device sync. The first full reviewer pass found one issue: a modal group editor. The final verdict marked the anchored nonmodal editor fix resolved, with no regressions and a ship disposition at that fix scope; it was not a second full-application review. Subsequent functional and keyboard-order fixes did not change the reviewed appearance; they were not a new visual review.

Implementation handoff validation: one design detector returned zero findings; focused feature/recovery/navigation checks and TypeScript passed. The final ESLint batch exposed one type-import violation in `workspace/model.ts`; its isolated repaired rerun passed, and the other scoped files passed the batch. The desktop production Vite build passed with existing large-chunk warnings; targeted formatting and diff checks passed. A pre-existing `SpaceWorkspaceRail` test still expects a Settings link absent from its management API. These claims are bounded to the changed feature and recorded handoff, not application-wide validation. This documentation pass changes no implementation and does not regenerate root tokens or a root `.impeccable/design.json` sidecar.

## Topbar refresh

Custom titlebar and tab-strip icons share a 16px baseline, including tab icons. Icon-only app controls use the shared 24px target with a 4px inset, with no titlebar navigation toggle. The two-glyph virtual-window trigger retains the same inset and icon size. Windows caption buttons retain equal native-sized targets and use 16px glyphs with a matching stroke. Split controls remain together; a narrow divider precedes the virtual-window trigger, which includes an explicit downward chevron. The shared menu trigger owns its expanded chevron state.

Shared translucent interaction fills use `control-hover` (10% theme text) and `control-active` (16% theme text), increasing visibility while following both dark and light palettes. Buttons, icon buttons, menu triggers, navigation actions, toggles, segmented controls, and list rows use these shared fills where they previously used a faint text wash. Strong selected surfaces continue to use the existing active theme token.

Home is a normal, reusable workspace tab at `/home`: it appears in the tab strip, supports selection and closing, and survives workspace migration. Scheduled remains its own standalone page in the navbar.

The synthetic source-component preview in `.impeccable/review/topbar/` historically covered compact and labeled navigation, Home in the tab strip, the unclipped group submenu, group-editor focus handoff, and the virtual-window menu at 860px. Focused tests passed, including Home reuse/closing, compact-mode persistence, shell layout preservation, and portaled group creation. Typechecking remains blocked by two unrelated Settings errors. The detector reported only retained 10px count text and a pre-existing 10px radius; no new visual exceptions were introduced.

Tab-group refinement: the label shows only the name, toggles collapse on click, and opens configuration through right-click or the keyboard context action. The continuous horizontal accent follows the active tab outline. The source-component preview in `.impeccable/review/tab-groups-refined/` was checked at desktop and compact widths and with vertical tabs. All 25 focused tab-group/strip tests and scoped lint passed. Typechecking remains blocked by the existing SettingsNavigation and SettingScope errors.

Navigation visibility correction: `NavigatorRail.tsx` owns edge hover, keyboard reveal/Escape, menu hold-open, and native-browser pointer forwarding. Layout now exposes `navigator_auto_hide`; `navigator_compact`, expanded-width rendering, and the unused width default were removed. The current source-component fixture and captures are in `.impeccable/review/navbar-visibility/`. Browser verification covers pinned, hidden, edge-revealed, and menu states; native pointer integration is exercised through mocked events, not a native window session.

## Destination navigation and history

Home, Browser, Files, Agents, Scheduled, and each Space reuse their most recently used established view in the current virtual window. Selection restores the exact route and state, including a view inside a split arrangement. A missing destination opens a new window tab. Navigation never replaces an occupied pane or adds cross-destination Back entries. Private browser views are excluded from ordinary Browser destination reuse.

An unused New Tab or new split pane accepts the next destination, even if another instance already exists. Its starting page defaults to Home and is configurable under Settings → General → New tabs and splits (Home, Browser, Files, Agents). Interacting with its content or navigating commits that view. Settings, Search, Activity, and Sync remain utility overlays.

Back/Forward stays within the view's own content history. Restoring legacy cross-destination pane history recovers hidden views as visible tabs. Explicit closure retains the existing reopen-tab workflow and unsaved-work protections.
