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

The tab pane picker marks the current pane with a persistent neutral active fill instead of a checkmark. Keyboard focus uses an inset outline, and `aria-current` exposes the current pane to assistive technology. This tab-navigation exception does not change selection indicators in other menus.

Sources: [MistyTabGroups.tsx](MistyTabGroups.tsx), [WorkspaceLayoutTabs.tsx](WorkspaceLayoutTabs.tsx), [tabGroups.css](tabGroups.css), [GlobalNavigator.tsx](GlobalNavigator.tsx), [docking.css](docking.css), [navigatorMode.ts](../../../features/app-shell/navigatorMode.ts), and [tabGroups.ts](../../../features/workspace/tabGroups.ts).

## Colors

The shell remains neutral. The nine group colors identify membership through the label, dot, and connecting marker. Use one selected color throughout each group. Active tabs retain the shared card fill and bright text; group color does not replace selection styling or fill the workspace.

**The Membership Accent Rule.** Color connects labels and members; names, counts, and expanded state keep the grouping understandable without color.

## Typography

Inherit application typography without a new display face. Global navigation uses the navigation role, tabs use the tab role, and group labels use the compact semibold group-label role. Names truncate within the strip. Empty names display Unnamed group. Keep shared body and input styles in the group editor.

## Layout

The global navigator is 54px wide on either side and 38px tall on the top or bottom, with equal 10px horizontal outer gutters. Its modes are pinned and auto-hide. Auto-hide reserves no track and reveals the same mounted rail over the workspace; focus and open menus keep it visible. Settings → Layout and the keyboard shortcut control auto-hide. There is no titlebar toggle. Every tile is 34×34px around an 18px glyph; Space and Profile identities are 20px. Preserve accessible names on every tile.

All 16 supported navigation/tab combinations use `dockingGeometry.ts`: stable grid tracks, native titlebar reservations, tab insets and pane seams. Left navigation with top tabs is the visual reference. The other layouts transpose the same tile, gap, tray, footer and tab rules. Horizontal tab strips are 38px tall; vertical tab rows remain 28px. Side strips use up to 200px (bounded to 35% in narrow windows). New tab follows the tabs on every edge. Do not add orientation-specific borders or spacing patches outside this contract.

Layout settings expose Navigation position and Tabs position as the shared segmented pill selectors, without built-in or saved presets. Navigation and tabs can share any edge: navigation sits against the window edge, with tabs immediately inside. Top navigation shares the native titlebar. When neither navigation nor tabs is on top, the existing page toolbar reaches the window top; `useMergedTitlebar` reserves only the native button overlap in each topmost pane. A page without a toolbar uses its title in that space. Lower split panes retain their normal spacing.

`useDockingTransition` preserves mounted panes and shares the shell's 300ms ease-in-out timeline. Native webviews resume when actual track and relocation animations finish; reduced motion skips relocation. Auto-hide overlays do not reflow content. Shared overlay placement points menus, popovers and tooltips inward; Windows titlebar controls retain downward placement. Escape from revealed navigation returns focus to its edge control.

Use the approved black, white and gray shell palette from AGENTS.md. Historical accent guidance below does not authorize new colored shell controls.

Search, Activity, and Sync sit in the fixed footer, in that order directly above Settings and Profile. These five utility controls never show window-edge indicators, including when hovered, focused, active or open. Edge indicators belong only to navigation destinations. The Misty menu stays at the top, and destinations scroll independently between the header and footer.

Horizontal tab strips are (38px) tall. Group labels precede a contiguous block of tabs, with a continuous 2px color line from the label through the members, rising around the active tab’s top and sides. The scroll area reserves vertical clearance for that line. Horizontal tabs retain flexible widths bounded between (96px) and (232px).

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

Home is a normal, reusable workspace tab at `/home`: it appears in the tab strip, supports selection and closing, and survives workspace migration. Scheduled lives within Agents; legacy schedule links and saved tabs migrate to that section.

The synthetic source-component preview in `.impeccable/review/topbar/` historically covered compact and labeled navigation, Home in the tab strip, the unclipped group submenu, group-editor focus handoff, and the virtual-window menu at 860px. Focused tests passed, including Home reuse/closing, compact-mode persistence, shell layout preservation, and portaled group creation. Typechecking remains blocked by two unrelated Settings errors. The detector reported only retained 10px count text and a pre-existing 10px radius; no new visual exceptions were introduced.

Tab-group refinement: the label shows only the name, toggles collapse on click, and opens configuration through right-click or the keyboard context action. The continuous horizontal accent follows the active tab outline. The source-component preview in `.impeccable/review/tab-groups-refined/` was checked at desktop and compact widths and with vertical tabs. All 25 focused tab-group/strip tests and scoped lint passed. Typechecking remains blocked by the existing SettingsNavigation and SettingScope errors.

Navigation visibility correction: `NavigatorRail.tsx` owns edge hover, keyboard reveal/Escape, menu hold-open, and native-browser pointer forwarding. Layout now exposes `navigator_auto_hide`; `navigator_compact`, expanded-width rendering, and the unused width default were removed. The current source-component fixture and captures are in `.impeccable/review/navbar-visibility/`. Browser verification covers pinned, hidden, edge-revealed, and menu states; native pointer integration is exercised through mocked events, not a native window session.

## Destination navigation and history

Home, Browser, Files, Agents (including Scheduled), and each Space reuse their most recently used established view in the current virtual window. Selection restores the exact route and state, including a view inside a split arrangement. A missing destination opens a new window tab. Navigation never replaces an occupied pane or adds cross-destination Back entries. Private browser views are excluded from ordinary Browser destination reuse.

An unused New Tab or new split pane accepts the next destination, even if another instance already exists. Its starting page defaults to Browser and is configurable under Settings → General → New tabs and splits (Home, Browser, Files, Agents). Interacting with its content or navigating commits that view. Settings, Search, Activity, and Sync remain utility overlays.

Back/Forward stays within the view's own content history. Restoring legacy cross-destination pane history recovers hidden views as visible tabs. Explicit closure retains the existing reopen-tab workflow and unsaved-work protections.

Files and Spaces both use the shared NavigationTray and NavigationTrayItem components for identical tile padding, rounding, hover and selected highlights. Files contains Explorer and Transfers destinations. Selecting a destination resumes its most recent matching tab; an explicit blank tab or split hosts a new instance. The collapsed Files control carries the active edge marker, which moves to the selected child while expanded. Both trays follow all four dock positions and reduced-motion preferences.

Home, Browser, Agents, Files, Extensions, and Spaces can be reordered by dragging their main icon. Files and Spaces move with their expanded contents. The shared pointer-reorder interaction supplies the neutral insertion marker, drag preview, edge scrolling, Escape cancellation, and click suppression. Alt+Shift+Up/Down moves a focused destination in side rails; top/bottom rails use Left/Right. Child destinations and fixed header/footer utilities do not participate. Order is an account setting (`collections.tabs.navigator`), using the existing settings outbox and server schema. New destinations append to a saved order; unavailable destinations do not render. No separate local ordering preference is introduced.

## Connected tabs and reorder motion — October 3

Horizontal workspace tabs follow the supplied browser reference: one continuous tab strip without dividers, an active pull-tab joined to the pane with matching fill and no seam, and curved shoulders at the content edge. Bottom tabs mirror that geometry; side tabs retain their existing row layout. Browser chrome and the connected active tab share the neutral window-chrome surface tokens. Group decoration keeps its existing dedicated pseudo-elements.

Workspace and nested location tab strips opt into the shared pointer reorder animation. Neighbors slide for 180ms into the prospective order while the lifted tab follows the pointer; release settles into the committed position. Escape and interrupted gestures restore the original order. Whole-group moves include their visible members. Hit testing uses stable layout coordinates while items animate, accounting for scrolling. Reduced motion keeps the insertion feedback and removes animated settling. Other reorder surfaces retain their existing behavior.

Validation: 43 focused tests, TypeScript, and scoped lint passed. The actual component fixture in `.impeccable/review/connected-tabs/` was inspected at compact and desktop widths, in top/bottom/side positions, with groups, and with pointer reorder. The saved screenshot shows fixture content, not a signed-in native browser session.

Refinement: inactive workspace tabs share the strip instead of forming individual pills. A shared content-colored base connects the active pull-tab to the pane below (mirrored for bottom tabs). During a drag, an opaque tab preview stays above its neighbors and follows the strip axis through small pointer drift. Its center determines the insertion point independently of grab position; covered neighbors shift in the opposite direction. Unequal-width tabs can reach either end. The refined interaction passes 46 targeted tests and TypeScript.

Polar screenshot refinement: horizontal strips use a 38px band, 232px maximum tab width, and 12px upper corners and shoulders that terminate directly at the toolbar edge. The active tab uses a #222222 to #1c1c1c gradient (darkened on October 5, 2026 from the sampled #383838 to #303030 so the toolbar sits closer to the black strip); inactive tabs share the #242425 to #202122 strip. Close buttons appear on hover or keyboard focus (always on touch). The titlebar corner and browser toolbar share these chrome tokens. The curved outline stops where the shoulder begins, without a vertical line through the toolbar. No shelf or extra pane padding is added, and the pane corner masks are removed along the joined edge.

Frame correction: the horizontal tab strip uses the navigator's black, so the titlebar corner beside the traffic lights matches the rail. The pane keeps its standard seams and rounded corners from `dockingGeometry.ts`; the strip overlaps the pane's seam row by 1px and the active tab covers it. `ConnectedTabShape.tsx` draws each horizontal tab's fill and outline as one SVG path (14px corners and shoulders from `--tab-shoulder`, pane seam color), so the sides and shoulders have no paint seams. Only the active tab shows it at rest. A lifted tab's drag preview reveals its copy, so every dragged tab keeps the curved shape while neighbors slide. The preview casts no shadow onto the toolbar. Tabs start 6px (`dockingMetrics.tabInset`) below the strip edge. Tab content, close, group labels, New tab, the strip actions (split and window controls) and the traffic lights all share the 38px bar's center line. Tab content is therefore 3px above the middle of its own tab. The first tab's shoulder starts inside the titlebar inset, right after the traffic lights, and never closer than 12px to the strip edge, so it clears a rounded pane corner. Tab content is left-aligned: the favicon starts 12px inside the tab's leading side, and the title follows 8px later. The close control is always visible on every tab. Close and New tab share one stroke weight. Close is smaller: a 20px target with a 7px glyph, beside New tab's 24px target and 8px glyph. The close glyph ends 12px inside the tab's trailing edge, and the New tab glyph starts 12px outside it. Hovering an inactive tab shows a 10px-rounded neutral surface as tall as the active tab: inset 4px horizontally and 1px off the pane seam. The Browser toolbar is exactly its 44px grid row. A taller bar would overflow onto the page host, where it hides under the native page until a tab drag raises the app layer above it.

Tab presence motion: opening a horizontal tab grows it from zero width while it fades in. Closing one returns its last element as an inert ghost that collapses and fades in 180ms, so neighbors slide into place. `useTabPresenceMotion` reads the DOM after each commit, so buttons, shortcuts, menus and drags all animate. Changes of more than three tabs at once (virtual window switches, collapsing a group) and reduced motion swap instantly. Side strips are unchanged.
