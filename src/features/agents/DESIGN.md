---
name: "Misty Agents"
description: "A desktop Journal-style agent collection leading into conversations and their agent overview."
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
  welcome:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.3
  setup-heading:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "20px"
    fontWeight: 500
  overview-title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "16px"
    fontWeight: 600
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
  panel: "20px"
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
    backgroundColor: "{colors.card}"
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
  overview-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "20px"
  settings-panel:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text}"
    width: "420px"
---


# Design System: Misty Agents

## Overview

**Creative North Star: "Journal entry, Misty conversation"**

The Agents root is a Journal-style collection with Agents, Conversations, and Activity sections, search, specific creation actions, and shared list/grid controls. Selecting an agent or conversation opens the existing conversation and its optional overview. Misty's shared monochrome controls, restrained text-control corners, utility capsules, and existing cloud identity assets remain authoritative.

This scoped refresh supersedes the former roster-first entry and mobile shell behavior while retaining conversation, profile, setup, account-access, and companion rules below. Source authority is `AgentsPage.tsx`, `components/AgentCollection.tsx`, `agentsWorkspace.css`, the existing overview/conversation components, and shared `CollectionWorkspace`, `Button`, and `NavIsland`. See [Journal entry pages](../../../docs/design/journal-entry-pages/DESIGN.md) for the shared entry system and current evidence; `PRODUCT.md` and `companion/DESIGN.md` retain their relevant product and companion constraints.

**Key Characteristics:**

- The root collection leads into existing conversations and recorded activity.
- Standard text controls retain modest shared corners; collection icon utilities use shared capsules.
- UI chrome and status are monochrome; existing cloud artwork retains its identity colors.
- Desktop conversation and overview geometry do not switch to mobile Sheets.
- Account access, actual execution state, and explicit outputs remain truthful.

## Colors

Use Misty's semantic charcoal/cream tokens through the active theme. Preserve the frontmatter's CSS variable bindings; their names describe roles across dark and light themes.

### Primary

The bright text token supplies the filled primary/send action, paired with the background token for its glyph. Primary emphasis comes from neutral contrast.

### Neutral

Workspace is the open conversation canvas. Sidebar tone separates the companion/setup sheet. Card supports the overview, navigation islands, popovers, fields, message bubbles, composer, and recipient results. Border supplies hairline boundaries; muted text supports secondary metadata, section labels, and inactive controls. Hover and active tokens supply shared neutral interaction states.

**The Monochrome Chrome Rule.** Status uses text, icons, and contrast. Do not introduce colored status dots, tinted selections, or accent-colored focus rings. Existing cloud avatar colors are identity artwork rather than status signals.

## Typography

Use the inherited system UI stack. The welcome heading is 24px, weight 500, line-height 1.3; it introduces a fresh conversation without becoming a promotional hero. Setup headings use 20px at weight 500. The overview agent name uses 16px at weight 600. Body, composer, collection names, navigation, profile fields, and ordinary activity content use the 14px scale. Message prose uses line-height 1.6; the composer uses 22px.

Muted section labels and compact overview metadata use 12px. History dates and full activity metadata use 13px. The compact desktop overview activity titles use 13px and their metadata 12px. Collection names follow shared row/card treatment; messages, errors, results, and form content wrap. Message content is bounded by `min(82%, 72ch)`, and welcome supporting copy by 36ch. Avatar emoji sizing is separate from the prose hierarchy.

## Layout

The root fills the desktop workspace with the shared collection page. Its heading and search/action row precede section tabs, utility capsules, and rows or cards. The Agents table exposes actual status and last activity; Conversations shows the owning agent; Activity retains recorded work. The old persistent roster is not rendered. Selecting a row opens the flexible conversation with a 340px overview rail when requested. The rail scrolls independently, has 16px outer padding except at its left edge, and contains a single shared Card with 20px padding. Conversation headers are 54px tall.

The centered header identity and right-side panel control toggle the overview. The desktop overview is initially visible for a selected agent; opening setup/companion or the new-chat recipient chooser hides it. Conversations, Activity, and Profile live inside the overview as text-only popover triggers. They no longer form a centered strip above the transcript. The action island above them contains Talk and Companion with monochrome icons.

The shell is desktop-only. It has no viewport-triggered overview Sheet, roster replacement, or narrow-screen switching. Back navigation returns to the entry collection through existing draft guards.

The transcript and composer share an 836px maximum region. Transcript padding is 28px 32px on wide layouts, with 18px between messages. Composer outer padding is 12px 24px 16px; its textarea grows from 38px to 160px. The welcome centers an 80px cloud, heading, short description or fallback question, and Customize agent action within the empty transcript, while the composer stays at the bottom.

The new-chat recipient chooser occupies the header and a compact results list beneath it. Its composer stays disabled until an agent is selected. Conversations' New chat starts with the current agent.

Profile/history/activity popovers remain workspace-bounded: 432px preferred width, a maximum of the viewport minus 24px and Radix's available width, 12px padding, and maximum height `min(580px, available height)`. They open with a 10px offset and 12px collision padding and scroll without resizing the conversation.

Creation and Companion reuse the existing 420px in-place Sheet with a 54px header and scrolling content. The conversation reserves its width while open; no breakpoint changes its presentation. This is an explicit editor/settings surface, not a mobile navigation replacement.

## Elevation & Depth

Tonal surfaces and hairline borders separate persistent chrome. The overview Card, composer, and message bubbles have no decorative shadow. The in-place companion/setup Sheet has no shadow or entrance animation. Navigation popovers inherit their shared overlay behavior, depth, and motion. Keep these treatments in the shared primitives rather than creating an Agents-only overlay system.

## Shapes

Use the shared radius scale: `--radius-md` (6px) for controls and fields, `--radius-lg` (8px) for islands, popovers, and recipient results, and `--radius-xl` (12px) for the shared overview Card, message bubbles, and composer. Conversation icon controls retain shared shapes; the collection filter and view utilities intentionally use round controls inside capsule islands. Shared switches retain their pill shape.

Cloud artwork retains its own silhouette. Collection agent avatars are 24px; header, transcript, and recipient avatars are 32px; desktop overview and profile avatars are 64px; the welcome and existing companion preview use 80px. The preview size is distinct from saved desktop companion scale. Preserve existing cloud animation and reduced-motion poster behavior.

## Components

### Shared controls and navigation

Use shared `Button`, `IconButton`, `Input`, `Textarea`, `Toggle`, `Card`, `NavIsland`, `Popover`, `Sheet`, and companion settings controls. Standard icon actions are 30px with accessible labels. Conversations, Activity, and Profile triggers stay text-only. Only one navigation popover opens at a time; the identity communicates overview visibility with `aria-expanded` and `aria-controls`.

Preserve disabled states, keyboard operation, dismissal guards, and focus restoration through the existing shared primitives. The shared components remain the authority for focus treatment; this documentation does not establish a new feature-specific ring or claim a full accessibility audit.

### Overview and current state

The overview order is identity and status, Talk/Companion actions, section navigation, Context, Computer, Recent activity, and Outputs. Use small muted section headings and ordinary rows rather than nested cards or colored badges.

The headline derives from actual profile, recording, conversation, and activity state. Disabled takes priority, followed by Listening, Needs your input, Working, Waiting for device, Queued, Loading activity, Activity unavailable, and Ready. The activity callback reports loading, unavailable, needs input, working, waiting for device, queued, or idle across the fetched entries, even when only three entries are shown. Approval or intervention requests must not be presented as Ready. Loading and fetch failures must remain explicit.

Talk uses the conversation's existing recorder and places the transcript in the draft for review. It changes to Stop recording while listening. It is unavailable for disabled agents, active conversation work, recorder setup/transcription, or a missing account. Companion opens the existing voice/computer controls; it does not imply provisioning a new computer or starting a realtime call.

### Account context and computer

Context describes the current Misty account and explicitly ties Space access to account permissions. Connections come from the account connection API; revoked connections are excluded. Active, unchecked, and other retained states read Connected, Not checked, and Needs attention. Preserve loading, empty, error, and retry states. Manage connections opens the existing connection manager. Setup does not silently grant new permissions or introduce per-agent app access.

Computer displays the local native device name and Online, Offline, Access revoked, or Device unavailable when those states are known. Without a native snapshot it explains availability in the desktop app. This is device availability, separate from account preferences or an agent-owned cloud computer. Account changes refresh the access data; stale requests must not cross account boundaries.

### Conversations, welcome, and composer

Conversations offers search, New chat, and saved rows with title, date, and latest-message preview. Reopening a historical conversation preserves its saved scope; new conversations remain personal. A fresh conversation shows the welcome and Customize agent, which opens Profile. If there is no agent, retain the direct creation action.

Use `MistyComposer` with `layout="conversation"` as the feature adapter over shared `MessageComposer` and `MessageComposerSend`. The same frame, growing textarea, action slots, and ArrowUp send affordance serve Spaces chat, Global Misty, and execution follow-ups; Agents-only composer CSS overrides are removed. Follow the [shared usage contract](../../shared/ui/patterns/MessageComposer.md). Input text is 14px on desktop and 16px below the shared medium breakpoint; this does not introduce a mobile Agents shell. Enter submits; Shift+Enter inserts a line break; composition events prevent premature submission. Keep recording, transcription, working, disabled-agent, and error feedback, along with attachments, citations, approval, cancellation, retry, and copy behavior. Preserve unsent-message guards during agent changes and result navigation.

### Activity and outputs

Recent activity initially shows three task entries with an option to view all. The Activity popover exposes the full activity surface. Both use the existing dashboard and keep title, textual state, timestamp, and monochrome status icon. Expanding a task reveals instruction, result, tool events, pending approvals, and cancellation where applicable. Parent-task context remains available. Activity is recorded work, separate from conversation history.

Outputs are explicit `resultHref` values on completed assistant actions in the selected agent's conversations. They are ordered from recent conversations/messages, deduplicated by destination, and restricted to safe internal `/spaces/` or `/files/` paths. Attachments and citations are not inferred to be outputs. Show three initially, View all outputs when needed, and No outputs yet when empty. Opening a result uses existing navigation and unsaved-change guards.

### Profile and setup

Profile retains avatar, name, description, instructions/memory disclosure, save/delete behavior, and existing conversation model selection. Dirty profile changes use the shared unsaved-change dialog before navigation or dismissal. Keep editing restores focus within the current editing context; Discard and switch continues the requested action.

Create new agent uses three steps inside the existing creation Sheet. Identity includes an existing cloud preview/picker, required name, purpose, and optional instructions disclosure. Context reviews account access and opens Manage connections; it does not request new agent-specific permissions. Start offers Chat in Misty or, on supported native macOS/Windows hosts, opening Desktop companion controls after creation. Unsupported hosts explain the limitation and disable that option. Selection uses neutral outlines and a check icon. Step headings receive focus after navigation; busy creation disables editing and navigation. The existing server save persists the profile, and a retry after a post-save refresh failure reuses the created ID rather than creating a duplicate.

### Companion and verification

Companion retains the existing `DesktopSettingsSection`/`DesktopSettingsRow` composition, cloud preview, behavior switches, size control, voice/model controls, and live status/error/retry handlers. Its in-place nonmodal Sheet has no portal or backdrop, initially focuses Close, restores its trigger when available, and honors unsaved-form and busy guards.

The redesign reuses the existing cloud variants and reduced-motion posters; custom emoji support remains in existing profile editing. Preserve raster provenance sidecars. No new raster artwork was generated for this implementation.

Current production-component entry captures at `.impeccable/review/journal-entry-implementation/` use deterministic fixture data at desktop width. The implementation pass reports 96 focused tests across 13 suites plus desktop build, typecheck, and scoped lint passing. Earlier `agents-dot` mobile captures are historical and do not define current shell behavior. These fixtures and mocked API tests do not establish native voice, cursor control, live account integration, or backend execution end to end.

## Do's and Don'ts

### Do:

- Do use the collection as the root entry and retain the existing conversation and optional overview after selection.
- Do keep the shell desktop-only without breakpoint-triggered navigation or overview Sheets.
- Do keep the 24px welcome heading and standard shared modest text-control radii, preserving the latest shared collection utility capsules.
- Do convey status through accurate words and monochrome icons.
- Do preserve account permissions, server persistence, historical scope, draft guards, and focus restoration.
- Do reuse the existing cloud assets and their provenance records.

### Don't:

- Don't restore the old centered navigation strip as the default selected-agent layout.
- Don't introduce colored status chrome, tinted selections, or an Agents-only control palette.
- Don't turn Talk into a claim of realtime calling or Computer into a claim of cloud provisioning.
- Don't infer outputs from attachments or citations, or invent per-agent connection permissions.
- Don't add a nested roster chat tree, bottom account footer, or persistent companion strip inside the conversation.
- Don't promote illustrative fixture data or mocked API coverage into live/native verification claims.
- Don't apply this feature's composition or avatar sizing as product-wide rules.

## September 30 follow-up

The collection explicitly grows to fill the horizontal Agents workspace. Validate the real `AgentsPage` parent, not an isolated collection. Entry sections are Agents, Conversations, Activity, and Scheduled. Scheduled reuses the account schedule store and task editor; selecting a schedule opens the existing conversation/details workspace within Agents. Returning to the collection retains the unsent-message guard. Legacy `/scheduled` links and persisted tabs migrate with their task selection intact.

Button groups are now unboxed. Shared `NavIsland` and selected-agent navigation retain semantic grouping and individual selected/focus states but no outer background or border. This supersedes capsule/island container styling described above. Content panels and popovers remain unchanged.

### Agent switcher follow-up

The conversation header’s agent name now opens a desktop Popover using shared Command search, matching the Chat switcher pattern. Show account agents and eight recent conversations; searching includes the full loaded conversation list. Mark the current agent and conversation with monochrome check icons. New agent and Browse all agents remain at the end. The separate panel icon still toggles the overview.

Opening or dismissing the switcher leaves the composer mounted. Selecting the current agent or conversation is a no-op. Selecting another goes through the existing draft/profile guard and is disabled during recording, uploads, saves or a running response. Accepted navigation updates the agent/conversation route and loads the selected history. Keep keyboard search, arrow/Enter selection, Escape dismissal and focus restoration. No mobile branches, new button-group containers or custom control styling.


### October 1 collection simplification

Agents opens on **All**, followed by Agents, Conversations, Activity, and Scheduled. All combines those four sources by last activity in the shared collection, with a Type column and each item opening its existing destination. No additional summary cards or section-launcher tiles are added. Activity opens the selected run's details; scheduled items open the scheduled task workspace. Explicit section URLs remain available.

Idle empty collections retain their table/grid surface without extra “No activity yet” or onboarding blocks. Loading, recoverable errors, and user-opened details remain functional. The same quiet empty-collection treatment applies to the related Spaces, Journal, Planner, Chat, Scheduled, and Library entry pages.
