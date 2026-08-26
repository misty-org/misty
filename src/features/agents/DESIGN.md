---
name: "Misty Agents"
description: "Agents opens straight into the selected agent's New task conversation, with Activity, catalogs, Integrations and a floating task panel."
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
  workspace-launch:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  workspace-launch-narrow:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  workspace-tag:
    fontSize: "10px"
    lineHeight: "16px"
  workspace-skill-action:
    fontSize: "11px"
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

**Current scope — October 2:** retain the root directory and add the approved Polar-like workspace for one selected agent. Its primary navigation, secondary catalog navigation and restrained content canvases use Misty's semantic monochrome palette. The existing conversation remains mounted while browsing catalogs or floating it inside the workspace. No mockup palette overrides or new raster artwork are introduced.

The current workspace paragraphs below supersede earlier selected-agent geometry, welcome size and fixed-width/no-breakpoint guidance in this document. Earlier detail is retained as history and as the contract for existing account, profile, conversation and companion behavior. Current sources are `AgentsPage.tsx`, `components/AgentWorkspaceConversation.tsx`, `workspace/AgentWorkspaceFrame.tsx`, `workspace/AgentWorkspaceCatalog.tsx`, `workspace/AgentControlBar.tsx` and the two workspace stylesheets. The root collection is unchanged by this pass.

**Creative North Star: "Journal entry, Misty conversation"**

The Agents root is a Journal-style collection with Agents, Conversations, and Activity sections, search, specific creation actions, and shared list/grid controls. Selecting an agent or conversation opens the existing conversation and its optional overview. Misty's shared monochrome controls, restrained text-control corners, utility capsules, and existing cloud identity assets remain authoritative.

This scoped refresh supersedes the former roster-first entry while retaining conversation, profile, setup, account-access, and companion rules below. Source authority is `AgentsPage.tsx`, `workspace/AgentWorkspaceFrame.tsx`, `agentsWorkspace.css`, the existing conversation components, and shared `CollectionWorkspace`, `Button`, and `NavIsland`. See [Journal entry pages](../../../docs/design/journal-entry-pages/DESIGN.md) for the shared entry system and current evidence; `PRODUCT.md` and `companion/DESIGN.md` retain their relevant product and companion constraints.

**Key Characteristics:**

- The root collection leads into existing conversations and recorded activity.
- Standard text controls retain modest shared corners; collection icon utilities use shared capsules.
- UI chrome and status are monochrome; existing cloud artwork retains its identity colors.
- Desktop conversation and overview geometry stays consistent at every window width.
- Account access, actual execution state, and explicit outputs remain truthful.

## Colors

Use Misty's semantic charcoal/cream tokens through the active theme. Preserve the frontmatter's CSS variable bindings; their names describe roles across dark and light themes.

### Primary

The bright text token supplies the filled primary/send action, paired with the background token for its glyph. Primary emphasis comes from neutral contrast.

### Neutral

Workspace is the open conversation canvas. Sidebar tone separates the companion/setup sheet. Card supports the overview, navigation islands, popovers, fields, message bubbles, composer, and recipient results. Border supplies hairline boundaries; muted text supports secondary metadata, section labels, and inactive controls. Hover and active tokens supply shared neutral interaction states.

**The Monochrome Chrome Rule.** Status uses text, icons, and contrast. Do not introduce colored status dots, tinted selections, or accent-colored focus rings. Existing cloud avatar colors are identity artwork rather than status signals.

## Typography

The selected-agent launch heading now uses 32px, weight 400, line-height 1.2 and -0.025em tracking; it becomes 26px below the 760px workspace container breakpoint. Catalog headings use 20px/600 with 30px line-height, ordinary content 14px, and compact schedule/detail tags and skill actions 10–11px. These are scoped, approved additions, recorded in frontmatter; five detector advisories for this type scale were reviewed without requiring changes. The following 24px welcome specification describes the earlier conversation presentation, not the new launch surface.

Use the inherited system UI stack. The welcome heading is 24px, weight 500, line-height 1.3; it introduces a fresh conversation without becoming a promotional hero. Setup headings use 20px at weight 500. The overview agent name uses 16px at weight 600. Body, composer, collection names, navigation, profile fields, and ordinary activity content use the 14px scale. Message prose uses line-height 1.6; the composer uses 22px.

Muted section labels and compact overview metadata use 12px. History dates and full activity metadata use 13px. The compact desktop overview activity titles use 13px and their metadata 12px. Collection names follow shared row/card treatment; messages, errors, results, and form content wrap. Message content is bounded by `min(82%, 72ch)`, and welcome supporting copy by 36ch. Avatar emoji sizing is separate from the prose hierarchy.

## Layout

**Current selected-agent workspace:** the primary sidebar is 240px and catalog secondary navigation 208px. Workflow/template content is bounded at 960px, connectors at 1088px, instructions at 768px, and the empty-conversation launch composer at 672px. The launch prompt and composer sit together in the upper central canvas; an active full conversation retains its bottom composer and optional right details. The sidebar includes New task, Activity, Workflows, Templates, Integrations and Recents. Agent settings open from the switcher and Float conversation from the conversation's ⋯ menu.

At a workspace container width of 1100px or less, navigation becomes 190px/170px and catalogs use two columns. At 760px or less, primary navigation becomes a 58px icon rail, secondary navigation moves above content, cards use one column, skills stack and the overview is hidden. These defensive narrow layouts supersede earlier no-breakpoint rules; they do not add an overview Sheet. Floating uses the same mounted conversation in an in-workspace panel, 660px wide and bounded by the available canvas, with 24px inset (12px narrow). It is not an OS window.

The root fills the desktop workspace with the shared collection page. Its heading and search/action row precede section tabs, utility capsules, and rows or cards. The Agents table exposes actual status and last activity; Conversations shows the owning agent; Activity retains recorded work. The old persistent roster is not rendered. Selecting a row opens the flexible conversation with a 340px overview rail when requested. The rail scrolls independently, has 16px outer padding except at its left edge, and contains a single shared Card with 20px padding. Conversation headers are 54px tall.

The centered header identity and right-side panel control toggle the overview. The desktop overview is initially visible for a selected agent; opening setup/companion or the new-chat recipient chooser hides it. Conversations, Activity, and Profile live inside the overview as text-only popover triggers. They no longer form a centered strip above the transcript. The action island above them contains Talk and Companion with monochrome icons.

The shell is desktop-only. It has no viewport-triggered overview Sheet, roster replacement, or narrow-screen switching. Back navigation returns to the entry collection through existing draft guards.

The transcript and composer share an 836px maximum region. Transcript padding is 28px 32px on wide layouts, with 18px between messages. Composer outer padding is 12px 24px 16px; its textarea grows from 38px to 160px. The welcome centers an 80px cloud, heading, short description or fallback question, and Customize agent action within the empty transcript, while the composer stays at the bottom.

The new-chat recipient chooser occupies the header and a compact results list beneath it. Its composer stays disabled until an agent is selected. Conversations' New chat starts with the current agent.

Profile/history/activity popovers remain workspace-bounded: 432px preferred width, a maximum of the viewport minus 24px and Radix's available width, 12px padding, and maximum height `min(580px, available height)`. They open with a 10px offset and 12px collision padding and scroll without resizing the conversation.

Creation and Companion reuse the existing 420px in-place Sheet with a 54px header and scrolling content. The conversation reserves its width while open; no breakpoint changes its presentation. This is an explicit editor/settings surface.

## Elevation & Depth

The current floating conversation uses `0 16px 48px #0005` to separate it from the catalog below. Catalog cards stay flat with semantic surfaces and hairline borders. This scoped floating treatment extends the existing depth rules below.

Tonal surfaces and hairline borders separate persistent chrome. The overview Card, composer, and message bubbles have no decorative shadow. The in-place companion/setup Sheet has no shadow or entrance animation. Navigation popovers inherit their shared overlay behavior, depth, and motion. Keep these treatments in the shared primitives rather than creating an Agents-only overlay system.

## Shapes

Use the shared radius scale: `--radius-md` (6px) for controls and fields, `--radius-lg` (8px) for islands, popovers, and recipient results, and `--radius-xl` (12px) for the shared overview Card, message bubbles, and composer. Conversation icon controls retain shared shapes; the collection filter and view utilities intentionally use round controls inside capsule islands. Shared switches retain their pill shape.

Cloud artwork retains its own silhouette. Collection agent avatars are 24px; header, transcript, and recipient avatars are 32px; desktop overview and profile avatars are 64px; the welcome and existing companion preview use 80px. The preview size is distinct from saved desktop companion scale. Preserve existing cloud animation and reduced-motion poster behavior.

## Components

### Current workspace and UI-only catalogs

New task selects an empty conversation for the current agent; Recents opens its exact history. Catalog navigation hides rather than unmounts the conversation. Floating and returning to the full conversation preserve its draft and existing state. Agent settings opens the existing profile editor. The Agents-only work-location control identifies the current conversation; separate-window and window-control options are disabled and labeled Coming soon. Scheduled does not opt into this control.

Templates support browsing, search, categories and detail dialogs. Use template seeds an unsent draft through the existing discard guard. Workflow, schedule, instruction and skill inputs are React drafts only. New save, import, scheduling and connector-connect actions are disabled with explicit availability copy; they do not persist, call new APIs or imply new execution. Existing account connections and conversation/voice actions retain their original behavior.

Use shared monochrome controls, checkmarks for menu selections and the existing semantic color tokens. Preserve shared item-type glyph tones where applicable; chrome, focus and status remain monochrome. Do not add a collection filter duplicating visible section tabs.

The production `AgentsPage` fixture harness has 14 reviewed captures covering 1304px, 1920px, 900px and 390px widths. Fidelity and UI-scope review concluded SHIP without material fixes. This pass reports 41 tests across five suites, full TypeScript, scoped ESLint and desktop Vite build passing; build chunk-size warnings remain. All 14 screenshot rasters passed provenance scanning. These are fixture/component checks, not live account, backend execution or native-capability verification. See [implementation evidence](../../../docs/design/agent-workflows/IMPLEMENTATION.md).

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

Use `MistyComposer` with `layout="conversation"` as the feature adapter over shared `MessageComposer` and `MessageComposerSend`. The same frame, growing textarea, action slots, and ArrowUp send affordance serve Spaces chat, Global Misty, and execution follow-ups; Agents-only composer CSS overrides are removed. Follow the [shared usage contract](../../shared/ui/patterns/MessageComposer.md). Input text is 14px on desktop and 16px below the shared medium breakpoint. Enter submits; Shift+Enter inserts a line break; composition events prevent premature submission. Keep recording, transcription, working, disabled-agent, and error feedback, along with attachments, citations, approval, cancellation, retry, and copy behavior. Preserve unsent-message guards during agent changes and result navigation.

### Activity and outputs

Recent activity initially shows three task entries with an option to view all. The Activity popover exposes the full activity surface. Both use the existing dashboard and keep title, textual state, timestamp, and monochrome status icon. Expanding a task reveals instruction, result, tool events, pending approvals, and cancellation where applicable. Parent-task context remains available. Activity is recorded work, separate from conversation history.

Outputs are explicit `resultHref` values on completed assistant actions in the selected agent's conversations. They are ordered from recent conversations/messages, deduplicated by destination, and restricted to safe internal `/spaces/` or `/files/` paths. Attachments and citations are not inferred to be outputs. Show three initially, View all outputs when needed, and No outputs yet when empty. Opening a result uses existing navigation and unsaved-change guards.

### Profile and setup

Profile retains avatar, name, description, instructions/memory disclosure, save/delete behavior, and existing conversation model selection. Dirty profile changes use the shared unsaved-change dialog before navigation or dismissal. Keep editing restores focus within the current editing context; Discard and switch continues the requested action.

Create new agent uses three steps inside the existing creation Sheet. Identity includes an existing cloud preview/picker, required name, purpose, and optional instructions disclosure. Context reviews account access and opens Manage connections; it does not request new agent-specific permissions. Start offers Chat in Misty or, on supported native macOS/Windows hosts, opening Desktop companion controls after creation. Unsupported hosts explain the limitation and disable that option. Selection uses neutral outlines and a check icon. Step headings receive focus after navigation; busy creation disables editing and navigation. The existing server save persists the profile, and a retry after a post-save refresh failure reuses the created ID rather than creating a duplicate.

### Companion and verification

Companion retains the existing `DesktopSettingsSection`/`DesktopSettingsRow` composition, cloud preview, behavior switches, size control, voice/model controls, and live status/error/retry handlers. Its in-place nonmodal Sheet has no portal or backdrop, initially focuses Close, restores its trigger when available, and honors unsaved-form and busy guards.

The redesign reuses the existing cloud variants and reduced-motion posters; custom emoji support remains in existing profile editing. Preserve raster provenance sidecars. No new raster artwork was generated for this implementation.

Earlier production-component entry captures at `.impeccable/review/journal-entry-implementation/` use deterministic fixture data at desktop width. That earlier implementation pass reported 96 focused tests across 13 suites plus desktop build, typecheck, and scoped lint passing. These fixtures and mocked API tests do not establish native voice, cursor control, live account integration, or backend execution end to end.

## Do's and Don'ts

For the current workspace, preserve the directory, mounted conversation, guarded unsent template draft and disabled future capabilities. Apply the responsive layout and launch typography specified above. Earlier fixed-width and 24px welcome guidance below is retained for historical context and does not override this scoped implementation.

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

The conversation header’s agent name now opens a desktop Popover using shared Command search, matching the Chat switcher pattern. Show account agents; conversations join the list only while searching, since the sidebar lists recents. Mark the current agent and conversation with monochrome check icons. New agent and the selected agent's settings remain at the end. The separate panel icon toggles the task panel.

Opening or dismissing the switcher leaves the composer mounted. Selecting the current agent or conversation is a no-op. Selecting another goes through the existing draft/profile guard and is disabled during recording, uploads, saves or a running response. Accepted navigation updates the agent/conversation route and loads the selected history. Keep keyboard search, arrow/Enter selection, Escape dismissal and focus restoration. Use the existing shared controls and desktop interaction model.


### October 1 collection simplification

Agents opens on **All**, followed by Agents, Conversations, Activity, and Scheduled. All combines those four sources by last activity in the shared collection, with a Type column and each item opening its existing destination. No additional summary cards or section-launcher tiles are added. Activity opens the selected run's details; scheduled items open the scheduled task workspace. Explicit section URLs remain available.

Idle empty collections retain their table/grid surface without extra “No activity yet” or onboarding blocks. Loading, recoverable errors, and user-opened details remain functional. The same quiet empty-collection treatment applies to the related Spaces, Journal, Planner, Chat, Scheduled, and Library entry pages.

## Phase 1–2 folder work and shared run controls

The current functional extension is described in PRODUCT.md. Historical UI-only restrictions still apply to catalog editors, integrations and future window modes; they do not prohibit the newly implemented shared lifecycle and bounded native folder executor.

Use the same small monochrome folder-work row in the workspace and floating composer. Keep folder selection below the popup's identity and message input. A collapsed receipt exposes verified counts; its disclosure shows source → destination and text status, with Stop changes, Resume verified plan and Undo verified changes only where applicable. An undone receipt counts undone operations. Folder proposal review uses readable paths rather than JSON, including when access is restoring or unavailable. Existing shared Button/IconButton styling and the simple sidebar remain authoritative.

## Phase 4 catalog behavior — October 3

The approved sidebar and catalog columns remain unchanged. Saved methods use quiet rows with their version, enabled state, work location and direct actions. The protected-focus editor uses shared Dialog, Input, Textarea, Checkbox and OptionSelect controls; all selections and states remain monochrome. Required questions retain unanswered state, including yes/no questions, until the user answers them. Saving reports conflicts without discarding the draft. Templates open an unsent draft through the workspace's existing navigation guard. Scheduled workflows visibly retain their version and lead to the existing schedule editor; pinned instructions are read-only there.


### Connected account summary — October 3, 2026

The Context rows list the account's connected apps. Connected apps belong to the account and every agent can use them, so rows show only the app, its account alias and whether it is connected, waiting for sign-in or needs attention. Manage connections opens Apps. Retry and empty states remain distinct, and account changes immediately hide the prior account's rows. Shared Button, Cable icon, typography, geometry and monochrome tokens are unchanged.

## Conversation management — October 3

Conversation collection rows, workspace recents, history rows and the open conversation header expose Rename and Delete through the shared monochrome overflow menu. Rename uses a focused shared dialog; Delete requires confirmation and explains permanent deletion and draft removal. Both use the existing account conversation endpoints. Pending requests disable submission, failures keep the dialog and conversation available for retry, and successful deletion clears the open conversation route without switching agents. Active responses must stop before deletion.

## One owner per control — October 3

Each workspace control appears once. The sidebar header holds the agent switcher (the workspace's only agent identity); it replaces the static avatar and name. Inside the workspace, the conversation header shows only the open conversation's title, its overflow menu and the panel toggle; Back, the switcher and New chat are not repeated there, since the sidebar carries them and New task. Outside the workspace (the cross-agent New chat chooser), the full header is unchanged.

The details panel starts with Status and no longer repeats the avatar and name, Talk (the composer's microphone does this) or Companion (the Computer row opens it). Its Conversations/Activity/Profile island is not shown inside the workspace: Recents and the switcher cover history, Recent activity has View all activity, and Agent settings opens the profile editor in the existing in-place sheet, titled Agent settings. In the panel, Context omits its explanatory line (available as the row's title), and activity titles clamp to two lines.

Recents rows have no repeated chat glyph; their overflow menu appears on hover, on focus, on the current conversation or while open. Folder work joins the work-location row under the composer, with its controls at the end of the row and any receipt spanning the full width below. A fully undone receipt is no longer shown.

The header spans the conversation and the details panel; the panel sits beneath it, so the panel toggle stays above what it reveals, with the card's right edge aligned to the toggle's 16px inset. Opening and closing animate the rail's width over 260ms (`cubic-bezier(0.2, 0.8, 0.2, 1)`) while its fixed-width content slides 32px and fades, so the conversation reflows instead of jumping. The panel mounts on first opening and then stays mounted (inert and hidden from assistive technology while closed). Reduced motion switches instantly.

Tool activity inside an expanded task is a quiet 12px disclosure reading "N steps" (plus "· N failed" when any step errored) with a wrench and a rotating chevron, not a native summary marker. It opens a bounded (260px) timeline: one row per tool call, with its start, progress and end events merged, a humanized tool name (`browser_navigate` → Browser navigate), and the latest text or error clamped to three lines. A hairline joins the step icons. Errors use the alert icon and stay monochrome. Source: `components/ToolActivity.tsx`.

## Answers and progress updates — October 3

Each prompt's replies form one turn. Only the last visible reply renders as the answer bubble, with its citations, actions and copy/retry controls. Earlier replies in the turn ("Got it, starting…", "Submitted, waiting for the browser…") fold into a quiet 12px "N progress updates" disclosure above the answer, with a checklist icon and a rotating chevron. Expanded, each update is 13px muted prose on a left hairline, with its completed action card. Actions that still need the person (approval, proposed confirmation, running work that can be stopped) stay visible below the disclosure. While a turn is still running, its latest reply is the visible one, so live progress remains readable. Source: `components/AgentSteps.tsx` and `conversationTurns` in `AgentConversationView.tsx`.

## Composer control bar — October 3

This supersedes the work-location row under the composer. A control bar now sits on top of the composer as a tab behind its top edge: 14px inset, 1px border without a bottom edge, top corners at `--radius-xl`, and the card surface at 55%. Its 28px controls use 12px muted text that brightens on hover or while open. Folder work starts on the left; while a task works in a separate window, Show agent window joins it. There is no work-location choice: screens open on demand (see docs/design/agent-architecture/BRIEF.md, Phase 3). Usage sits at the end: a 36px monochrome meter, the weekly percentage and, while drafting, "· ≈N% this message" (hidden below the 760px container width). The usage popover opens upward with Weekly AI usage (used of limit, reserved, reset date) and This message (billing's estimate, ceiling and explanation). Folder receipts, errors and window notices span the full width below the controls. The Agents composer omits its footer estimate (`hideUsageEstimate`); other composers keep it. Sources: `workspace/AgentControlBar.tsx`, `workspace/AgentUsageControl.tsx` and `useCommandUsageEstimate` in `global-search/CommandUsageEstimate.tsx`.

## Conversation-first entry (2026-10-05)

Supersedes the Agents collection. `/agents` opens the selected agent's New task conversation: the agent in the URL, else the last-used agent, else Misty, else the first agent. There is no directory page and no Back control.

- **Sidebar:** the agent switcher, then New task, Activity, Workflows, Templates, Integrations and Recents. No footer.
- **Switcher:** agents with a checkmark on the current one, conversations only while searching, then New agent and the selected agent's settings.
- **Empty composer:** the launch prompt, the composer, a row of context chips (this computer, shared folders, connected apps with brand logos, apps needing attention) that open Integrations, then two columns on the composer's edges: recent work and templates. "Organize a folder" is the first template; the folder control appears above the composer only while a folder is in progress.
- **Usage:** an 18px monochrome ring beside the mic that opens the usage popover.
- **Header:** the conversation title, its ⋯ menu (Float conversation, Rename, Delete) and the task panel toggle only. Status never appears in the header.
- **Task panel:** a floating card describing this conversation only: status, start and update times, device, and tool steps.
- **Activity:** account-wide Recent and Scheduled tabs; legacy `?view=activity|automations|scheduled` links open it.
- **Integrations › Apps:** Connected apps, Add an app, Shared folders and This computer on one scrolling page. Brand logos use the shared `BrandIcon` artwork; everything around them stays monochrome.
