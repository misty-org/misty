---
name: "Misty Agents"
description: "The approved quiet conversation layout, with a toggled navigation island and Misty shared controls."
colors:
  workspace: "var(--color-charcoal-workspace)"
  background: "var(--color-charcoal-bg)"
  sidebar: "var(--color-charcoal-sidebar)"
  card: "var(--color-charcoal-card)"
  border: "var(--color-charcoal-border)"
  hover: "var(--color-charcoal-hover)"
  active: "var(--color-charcoal-active)"
  text: "var(--color-cream)"
  bright: "var(--color-cream-bright)"
  muted: "var(--color-cream-muted)"
typography:
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  message:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  composer:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
  metadata:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "13px"
    fontWeight: 400
  control:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "14px"
    fontWeight: 500
  compact-metadata:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "12px"
    fontWeight: 400
  shortcut:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "16px"
  avatar-emoji:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "18px"
    fontWeight: 500
rounded:
  md: "var(--radius-md)"
  lg: "var(--radius-lg)"
  xl: "var(--radius-xl)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  roomy: "32px"
components:
  toolbar-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: "30px"
  primary-button:
    backgroundColor: "{colors.bright}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    size: "30px"
  outline-button:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  roster-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "64px"
    padding: "8px 10px"
  field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 10px"
  message-bubble:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    typography: "{typography.message}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
  conversation-composer:
    backgroundColor: "color-mix(in srgb, var(--color-charcoal-card) 95%, transparent)"
    textColor: "{colors.text}"
    typography: "{typography.composer}"
    rounded: "{rounded.xl}"
    padding: "6px"
  recipient-list:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "4px"
    width: "min(320px, calc(100% - 40px))"
  navigation-island:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "3px"
  navigation-dropdown:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "12px"
    width: "432px"
  companion-setting-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "16px"
  settings-panel:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text}"
    width: "420px"
---

# Design System: Misty Agents

## Overview

**Creative North Star: "Grok Bot layout, Misty controls"**

The Agents workspace follows the user-approved quiet Grok-like chat composition using Misty's shared theme, controls, and restrained corners. A flat roster, larger cloud avatars, centered agent identity, quiet transcript, and single bottom composer make conversation the default surface. The identity toggles a text-only navigation island immediately below it; Conversations, Activity, and Profile each open their own shared popover. Companion controls stay in a separate shared sheet.

This record refreshes the approved Agents implementation and applies only to this feature. The surface brief at `.impeccable/surfaces/src-features-agents-agentspage-tsx.md` holds the task context. Source authority is `AgentsPage.tsx`, `agentsWorkspace.css`, `components/AgentNavigationIsland.tsx`, the roster, editor, activity, and sheet components, and `companion/AgentCompanionPanel.tsx`, together with shared UI, `MistyComposer`, and `src/styles/styles.css`. There is no root `PRODUCT.md` or `DESIGN.md`; this record makes no new product-wide strategy claims.

The current approved references are repository-root `.impeccable/mocks/agents-persistent-island`, with the user's text-only/no-chevron triggers and identity-toggle qualifications. Actual production components rendered with illustrative fixture data are recorded in `.impeccable/review/agents-island-final/{desktop,conversations,profile,activity,island-hidden,companion,mobile,split-pane,light}.png`; the README and detector report share that directory, and `.impeccable/review/hero-repro.png` records the hero view. These supersede the earlier `grok-direct` layout references. The finish review accepted the visual fidelity and identified stale documentation as its only required fix; this refresh records that implementation.

**Key Characteristics:**

- A quiet conversation canvas with one composer and a flat searchable roster.
- A centered identity toggle and three text-only popover triggers.
- Theme-bound neutral surfaces and reused cloud identity assets at clear contextual sizes.
- Independent task activity and on-demand companion settings.
- Container-responsive views that preserve draft, profile, conversation scope, and focus behavior.

## Colors

The palette is Misty's global semantic charcoal/cream system, which resolves through the active theme. Token names describe roles even when a light theme reverses their visual tone. Preserve the CSS variable bindings in the frontmatter; do not introduce an Agents-only dark or light palette.

### Primary

The bright text token supplies the filled send action, paired with the background token for its glyph. Existing shared semantic treatments continue to represent errors, progress, and other message states where required.

### Neutral

Workspace is the open conversation canvas. Sidebar separates the roster and companion/create sheet; card supports the navigation island, popovers, settings groups, message bubbles, fields, composer, and recipient results. Border supplies hairline boundaries. Text is ordinary content, muted is secondary metadata and inactive toolbar labels, and hover/active support shared control states.

**The Shared Theme Rule.** Agents uses the same semantic color variables and control states as the rest of Misty.

## Typography

Use the inherited system UI stack. Main body, conversation prose, composer input, roster names, identity, island controls, profile fields, history previews, and activity content use the body/control scale. History dates, task status, avatar expression captions, and companion section labels use the metadata scale. Existing roster previews, search result copy, notices, and helper text keep the smaller compact-metadata scale. The companion shortcut has its own larger role; emoji sizes belong to avatar rendering, not prose hierarchy.

There is no display type or Agents page heading. Names and roster previews truncate on one line; messages, task results, errors, and form content wrap. Message content is bounded by the narrower of the available message percentage and a readable text measure (72ch). Shared form labels and controls retain their shared type styling.

## Layout

The desktop React/Tauri surface uses the web token system and responds to its workspace container. A fixed roster (244px) has a search field and New chat action in a compact header (54px), then scrolling agent rows (64px). Rows can include the latest conversation title beneath the name; history does not expand into a nested tree. Search matches agent names and saved chat titles. There is no Agents heading, bottom account area, or Connect apps action. The main header is also (54px), with centered identity and a companion pointer action.

The island sits immediately below the identity, centered in the conversation with a small internal gap (2px), compact inset, and bottom separation (4px). Its maximum width leaves a workspace inset (24px). It is initially visible for a selected agent; clicking the identity hides or reveals it. The identity button has a compact horizontal inset (4px) and a reserved chevron slot that appears on hover, keyboard focus, or while the island is open; it points up when open. The three island triggers remain text only. New chat shows the recipient chooser instead of the island. Each section opens a shared popover below its own trigger with an offset (10px), collision padding (12px), and the workspace element as its collision boundary. Dropdowns use the documented width, capped by the viewport and Radix's available width, and a maximum height of the lesser of (580px) and available height. Their content scrolls independently; opening one does not resize the conversation.

The transcript and composer share a maximum region (836px). The transcript scrolls above the composer with message separation (18px); bubbles are bounded by `min(82%, 72ch)`. The composer has outer padding (12px 24px 16px), one row of controls, and an attachment row when needed. Its textarea grows from (38px) to (160px). The roster New chat action places a To field in the header and a compact recipient list below it; the composer stays disabled until a recipient is selected. Conversations' New chat action starts a conversation with the current agent.

Companion and Create new agent use an in-place right sheet with a header (54px) and independently scrolling content. On wide panes the main region reserves the documented sheet width. At container widths up to (960px), the sheet replaces the main conversation region while retaining the roster. At (720px), the roster narrows to (220px), transcript/composer insets tighten, and the sheet uses the remaining width. At (600px), roster and conversation alternate as full-width views and the sheet uses the full available width. Popovers remain bounded to their workspace in both compact and full-width views.

## Elevation & Depth

Tonal surfaces and hairline boundaries separate persistent workspace chrome. The conversation composer, message bubbles, and companion/create sheet have no decorative shadow; the sheet has no entrance animation. The navigation dropdowns use shared `Popover` surface, border, radius, shadow, and motion. Shared fields and controls retain their component styling. Shared color transitions use the incumbent duration and easing, while working states reuse existing indicators.

**The Quiet Chrome Rule.** Keep persistent workspace chrome flat and reveal secondary controls when requested.

## Shapes

Use the shared radius scale: medium for buttons and fields, large for the island, dropdowns, settings groups, and recipient list, and extra-large for message bubbles and the conversation composer. The shared defaults resolve to restrained corners (6px, 8px, and 12px respectively). Icon controls remain square with medium corners; shared switches retain their native pill shape.

Cloud assets keep their own silhouette. Roster avatars are (40px); centered header, transcript, and recipient avatars are (32px); the profile avatar is (64px); the companion settings preview is (80px). The preview's display size is distinct from the saved desktop companion scale. Reuse the existing assets rather than adding a second identity treatment.

## Components

### Shared controls and navigation

Use shared `Button`, `IconButton`, `Input`, `Textarea`, `Toggle`, `Pressable`, `Popover`, `Sheet`, `Switch`, `Slider`, and `Select`. The standard icon action is (30px) with an accessible label. Island triggers use small toolbar buttons with only Conversations, Activity, and Profile text; they have no chevrons or icons. The identity communicates island visibility with `aria-expanded` and `aria-controls`. Only one section popover is open at a time. Roster rows use shared ghost styling and `aria-pressed`; history also identifies the current conversation.

Preserve disabled states, keyboard operation, popover dismissal, and focus restoration through the shared primitives and page guards. The shared controls declare focus treatments, while global CSS currently suppresses focus halos. That global behavior is not an Agents design rule or a claim of visible-focus coverage.

### Conversations and composer

Conversations contains a search field, New chat action, and saved conversation rows with a title, date, and latest message preview. It remains separate from task activity. Reopening a historical conversation preserves its saved scope; new conversations remain personal.

Use `MistyComposer` with `layout="conversation"`. This layout has restrained corners, no shadow, a growing textarea, and the shared square send control; other composer consumers retain their default layout. Attachment, microphone, send, and stop controls remain shared actions. Recording, transcription, working, errors, and disabled-agent feedback appear only when state requires them. Enter submits and Shift+Enter inserts a line break; composition events avoid premature submission. Keep the existing renderer's attachments, citations, approvals, cancellation, retry, and copy behavior. A fresh enabled conversation stays quiet; the absent-agent state retains a direct creation action.

### Activity

Activity lists independent task executions with title, status, and update time. Expanding a task reveals its instruction, result, tool events, pending approvals, and cancellation when applicable; delegated tasks can name their parent. Task rows may use a disclosure chevron, while island triggers remain text only. Activity has no conversation links. Loading, empty, error/retry, and busy action states remain visible. Scheduled navigates to scheduled work through the existing route.

### Profile

Profile shows the larger avatar and Change avatar control, name and description fields, and a collapsed instructions/memory disclosure. Existing avatar editing, memory actions, save/delete behavior, and conversation model selection remain available. Save changes appears for a dirty profile; Create agent appears in the creation sheet. Profile edits use the shared unsaved-change dialog before section changes, island dismissal, or navigation. Keep editing restores focus inside the existing dropdown. Discard and switch continues the requested action; when the roster New chat action opens the recipient chooser, focus lands in Search or create agents.

### Companion and creation sheet

The pointer action opens Companion in a shared nonmodal `Sheet`; agent creation uses the same sheet host. The sheet has no portal or backdrop, moves initial focus to Close, and restores its trigger when possible. It keeps the explicit unsaved-form guard and busy restrictions.

Companion uses `DesktopSettingsSection` and `DesktopSettingsRow`, with a centered existing sprite preview. Behavior contains one Show companion switch, an Ask before taking control switch, and a full-width size slider with percentage and Reset size action. Rows have a minimum height (64px) and a two-column label/control layout. Voice contains the native talk shortcut and a shared model select. The model trigger is (160px) capped by its available width. Active status and Stop appear when work is active; unavailable, error, and Retry companion states retain their existing command/state bindings. Companion is not a persistent strip in the conversation. See `companion/DESIGN.md` for the native overlay's separate behavior.

### Identity assets and verification

Reuse the existing cloud variants and their reduced-motion posters: Sky, Lavender, Mint, and Peach. Custom emoji remains supported. Avatar edits preview locally and persist through the existing save action. Preserve the raster provenance sidecars; this implementation introduces no new shipped raster asset.

The isolated production-component fixture verifies the approved desktop layout, all three dropdowns, hidden island, companion sheet, light theme, and workspace widths (390px and 690px). Browser interactions verify toggling, dropdowns, dirty-profile guards, and recipient-input focus after discard. The focused suite passed (28 tests across 6 suites), targeted ESLint passed, and whitespace checks passed. Full typecheck remains blocked by existing concurrent errors in `SettingsNavigation.tsx` (`.at`) and `SettingScope.tsx` (`unknown`) outside this scope. Native voice, cursor control, account integration, and live backend task execution were not exercised by the fixture; existing handlers remain connected, and mocked API tests establish delegation rather than end-to-end execution.

## Do's and Don'ts

### Do:

- Do preserve the approved quiet chat composition using Misty's shared theme and controls.
- Do keep the identity toggle immediately above the text-only Conversations, Activity, and Profile island.
- Do keep each section in its own workspace-bounded shared popover, and Companion in its shared sheet.
- Do keep task execution, status, results, approvals, and cancellation in Activity.
- Do preserve accessible labels, keyboard behavior, focus restoration, draft guards, and saved conversation scope.
- Do reuse the existing cloud assets and their provenance records.

### Don't:

- Don't restore the Agents heading, bottom account area, Connect apps action, nested chat tree, persistent Companion band, welcome suggestions, or keyboard hint footer on this surface.
- Don't add chevrons or icons to the three island triggers or conversation links to Activity.
- Don't introduce an Agents-only palette or replace shared controls with a separate visual language.
- Don't turn fixture screenshots or mocked API tests into claims of native voice, cursor control, account, or backend verification.
- Don't promote this feature's composition or avatar sizing into product-wide rules.
