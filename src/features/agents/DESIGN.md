---
name: "Misty Agents \u2014 Operate"
description: "Grok Bot structure with Misty identity: single-line roster, conversational start, bottom pill and full-height details."
colors:
  canvas: "#080808"
  sidebar: "#111111"
  bubble: "#262626"
  field: "#303030"
  text: "#eeeeee"
  muted: "#a0a0a0"
  divider: "#202020"
  search: "#242424"
  search-border: "#2d2d2d"
  search-hover: "#292929"
  selected-row: "#323232"
  avatar: "#3c3c3c"
  account-avatar: "#383838"
  option-border: "#404040"
  option-hover: "#393939"
  option-letter: "#494949"
  option-text: "#ddd"
  composer-border: "#474747"
  attachment-border: "#4a4a4a"
  voice-text: "#bdbdbd"
  voice-hover: "#505050"
  send: "#f4f4f4"
  send-disabled: "#4b4b4b"
  send-disabled-text: "#b7b7b7"
  selection: "#555"
  selection-text: "#fff"
  preview: "#1a1a1a"
  preview-border: "#282828"
  preview-hover: "#232323"
  recipient-hover: "#454545"
  dialog: "#191919"
  dialog-selected: "#343434"
  dialog-muted: "#aaa"
  light-canvas: "#fff"
  light-sidebar: "#f5f5f5"
  light-bubble: "#eee"
  light-field: "#e5e5e5"
  light-line: "#d4d4d4"
  light-text: "#161616"
  light-muted: "#606060"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  metadata:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  account-initials:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  avatar:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 500
  avatar-large:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 500
  avatar-header:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  avatar-recipient:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  avatar-search:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  composer:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
  compact-field:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
rounded:
  badge: "4px"
  bubble-join: "6px"
  icon: "7px"
  field: "8px"
  options: "9px"
  roster: "11px"
  recipient: "12px"
  dialog: "13px"
  transcript: "17px"
  bubble: "18px"
  composer: "26px"
  circle: "50%"
spacing:
  "3": "3px"
  "4": "4px"
  "5": "5px"
  "6": "6px"
  "7": "7px"
  "8": "8px"
  "9": "9px"
  "10": "10px"
  "12": "12px"
  "13": "13px"
  "14": "14px"
  "16": "16px"
  "17": "17px"
  "18": "18px"
  "20": "20px"
  "21": "21px"
  "22": "22px"
  "24": "24px"
components:
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.icon}"
    size: "32px"
  icon-button-hover:
    backgroundColor: "{colors.bubble}"
    textColor: "{colors.text}"
    rounded: "{rounded.icon}"
    size: "32px"
  search-trigger:
    backgroundColor: "{colors.search}"
    textColor: "{colors.muted}"
    rounded: "{rounded.field}"
    height: "32px"
    padding: "0 9px"
  roster-selected:
    backgroundColor: "{colors.selected-row}"
    textColor: "{colors.text}"
    rounded: "{rounded.roster}"
    height: "68px"
    padding: "10px"
  starter-group:
    backgroundColor: "{colors.bubble}"
    textColor: "{colors.text}"
    rounded: "{rounded.bubble}"
    padding: "12px"
    width: "80%"
  starter-option:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    padding: "8px 9px"
  custom-answer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    height: "32px"
    padding: "0 10px"
  conversation-composer:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.composer}"
    padding: "5px"
  send-button:
    backgroundColor: "{colors.send}"
    textColor: "{colors.sidebar}"
    rounded: "{rounded.circle}"
    size: "30px"
  send-button-disabled:
    backgroundColor: "{colors.send-disabled}"
    textColor: "{colors.send-disabled-text}"
    rounded: "{rounded.circle}"
    size: "30px"
  details-panel:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    width: "298px"
  activity-tile:
    backgroundColor: "{colors.preview}"
    textColor: "{colors.muted}"
    rounded: "{rounded.icon}"
  search-dialog:
    backgroundColor: "{colors.dialog}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    width: "min(520px, calc(100vw - 32px))"
---

# Design System: Misty Agents — Operate

## Overview

**Creative North Star: "Operate"**

The user-pinned Grok Bot layout is the structural authority for this scoped Agents surface: a quiet, dense roster and an open conversation, with details revealed alongside. Misty's identity, truthful capability language, and PRODUCT.md remain normative. This record replaces the rejected Agents design; it does not redefine other Misty surfaces or the root design record.

The composition begins with conversational greeting bubbles and four lettered choices, followed by a custom-answer field. A single bottom composer anchors the canvas. There is no centered hero, runtime exposition, or Marketplace entry. Inline Companion controls now precede the conversation: persistent Team/Auto choices, Cursor on/off, status, conditional Stop, and expandable Voice & model options. This replaces the earlier prohibition on persistent mode controls; detailed companion tokens and behavior live in `companion/DESIGN.md`. Misty uses the current desktop mark. Personal agents use the same mark in Sky, Lavender, Mint, or Peach unless a custom emoji is configured.

Source authority is AgentsPage.tsx, agentsWorkspace.css, components/AgentWorkspaceConversation.tsx, AgentSearchDialog.tsx, AgentAvatar.tsx, and AgentConversationView.tsx. WorkspaceCanvas.tsx supplies the conditional host-chrome treatment. Evidence is the real React component rendered with synthetic data: repository-root .impeccable/review/agents/grok-desktop.png (1045 × 768), grok-user-1111.png (1111 × 823), grok-mobile.png (390 × 844), grok-details.png, grok-settings.png, and grok-search.png; grok-reference-native.png is the actual Grok reference. The reviewer found desktop structural fidelity met and requested documentation replacement and larger mobile targets. The final verdict pass scored both the documentation and mobile-target corrections resolved (ship at that scope). These captures do not verify native Misty chrome, voice recording, live account integration, or AI backend execution. That earlier review did not observe native Misty. The later companion update has renderer captures at `.impeccable/review/cursor-agents/team.png`, `auto.png`, and `narrow.png`, plus the actual packaged macOS capture `packaged-macos-auto.png`. Packaged macOS observation confirms rendered original sprites and Team-to-Auto switching through the native controller, without establishing voice, multimonitor behavior, or Windows parity.

**Key Characteristics:**

- Single-line roster, compact header, and top-aligned conversational content.
- Near-black grayscale surfaces with small tonal steps and native system type.
- A single pill composer and full-height details, settings, or history panel.
- Container-responsive navigation with larger compact-screen controls.

## Colors

### Primary

Text and the enabled send button provide the brightest emphasis. There is no decorative brand accent in the workspace chrome. Cloud avatars provide the only decorative color accents; inherited action statuses may use semantic functional color.

### Neutral

Canvas, Sidebar, Bubble, and Field define the main tonal layers. Muted supports dates, placeholders, secondary controls, and activity labels. Selected Row distinguishes the active agent without adding a subtitle. The recorded border, hover, avatar, option-letter, dialog, and disabled-send variants are intentional values present in the implementation, not palette drift.

The workspace defines local `--agent-*` variables. The light theme overrides the seven core surface/text variables using the recorded light variants; fixed grayscale details and the search dialog retain their literal source colors. The captures establish the dark appearance only. Shared transcript action components retain their existing global semantic tokens.

**The Structural Fidelity Rule.** Preserve the reference's tonal hierarchy and layout while retaining truthful Misty content and capabilities.

## Typography

Use the native system stack and a compact body role throughout the roster, greeting, introductory copy, header, and choice labels. Header text inherits body sizing and weight; there is no display headline. Dates, choice letters, status lines, and history metadata use the metadata role. Names truncate to one line. Message content and settings copy wrap normally.

Avatar typography is context-specific: roster, header, search, recipient results, and large settings identity each have the source-derived role recorded above. Compact fields use the larger field role at the narrow container breakpoint. The composer declares its own body-sized text and line height; its specific selector remains authoritative over the general compact-field rule.

## Layout

The workspace fills its available pane and queries its own inline size. The roster has a fixed width (270px), inset horizontal padding (6px), a top row (44px), a search trigger (32px), scrolling single-line agent rows (68px), and a bottom account menu. The center flexes to remaining width. Its header is compact (44px) with identity at the left and actions at the right.

The dated welcome begins near the top. Greeting and introduction bubbles have a maximum width (80%); the choice group shares that width. There is no fixed centered content column. Conversation content scrolls independently above the composer, whose outer padding is (10px 16px 14px). Assistant transcript bubbles have a maximum width (80%); the shared user message renderer retains its own width (82%).

Details, settings, and history share one full-height right panel (298px) with a header (44px). At container widths up to (860px), an open panel replaces the conversation within the main region and takes the remaining width; greeting and choice widths expand to (94%). At widths up to (600px), the roster and active surface alternate. Header rows grow to (48px), the choice group and introduction can occupy full width, and composer padding includes the bottom safe area. Icon actions, including suggestion dismissal, become (44px × 44px); composer attachment, voice, send, and stop targets also become (44px × 44px). Other workspace buttons have a minimum height (44px).

The command search dialog is viewport-bounded (520px maximum with 32px total horizontal allowance), with a scrollable results area bounded by (380px or 60vh). Its CSS is separate from the workspace container.

The host suppresses the redundant official-app topbar only for a lone Agents surface. Multipane, tab, window, and Windows control requirements preserve host chrome. Component screenshots alone do not establish the native result of this condition.

## Elevation & Depth

The workspace uses flat tonal surfaces and hairline boundaries. The composer and search dialog explicitly have no shadow. Shared transcript components retain their own inherited details, including the user bubble's small shadow and semantic action styling; do not generalize the chrome rule into an unsupported claim about every child component. There is no dedicated panel entrance animation in the workspace stylesheet. Working and transcription indicators reuse existing spinner behavior.

**The Flat Chrome Rule.** Separate roster, conversation, and panels through tone and boundaries rather than decorative depth.

## Shapes

The main signature is the broad composer pill, paired with softly joined greeting and introduction bubbles and a rounded choice group. The two greeting bubbles have small joining corners on the left. Choice rows live inside one bordered group with internal dividers; the letter markers are small rounded rectangles. Roster selection, search, fields, menus, and the activity tile use their recorded restrained radii.

Avatars are clipped circular identities: roster (48px square), header (21px square), search (29px square), recipient results (25px square), and large settings identity (64px square). Attachment, voice, and send controls are circular. Keep the actual roster proportions rather than normalizing every avatar to a new size.

## Components

### Roster and account menu

Show one 48px avatar and one 16px agent name per 68px row, separated by a 12px gap, with `aria-pressed` selection and a tonal hover. Search opens command search rather than filtering this list in place. New chat opens recipient selection with a create-agent action. The account menu exposes Activity, Connections, Agent settings, and Create agent.

### Cloud avatars

All four color presets use the current monochrome Misty mark, bundled inline and tinted with a CSS mask. The mark is static, including under reduced-motion preferences. The picker and agent identities share the same asset.

The canonical mark is `src/assets/branding/misty-white.png`; the desktop icon is `src/assets/branding/misty-icon.png`. The identity picker previews immediately and persists through Save changes as `avatar.cloudVariant`, retaining that field and the existing color IDs for profile compatibility. Existing custom `avatar.emoji` values remain authoritative until a mark color is selected. New agents start with Lavender; older personal agents without a saved choice receive a stable ID-based variant. Other avatar metadata is preserved.

### Inline companion controls

The Companion section sits above the conversation scroll region and shares its controller and Team/Auto mode with native voice and the typed composer. Team/Auto is a radio group with roving Tab focus, arrow-key selection, and Home/End selection. Cursor visibility, working status, Stop, expandable voice/model options, and retryable errors stay in this section. Original WebP bytes are imported inline for packaged asset reliability. `companion/DESIGN.md` and its sidecar own the scoped control and overlay values; retain the rest of this Agents system.

### Greeting and choices

A centered date precedes two left-aligned conversational bubbles. The four A–D options populate the editable composer; the custom answer shares the draft and can submit with Enter. Dismiss removes the suggestion group. The absent-agent state offers creation; disabled agents expose a clear settings instruction.

### Composer and transcript

The bottom pill contains attachment, editable message, voice, and send/stop controls in one row. Attachment previews can add a row above. The textarea grows within its implemented limit (140px). Voice recording, transcription, working, errors, and disabled state have concrete UI; integration success has not been established by the captures. Enter sends, Shift+Enter creates a line break, and composition events avoid premature submission.

Conversation selection is scoped to the selected agent within the account-loaded history, without filtering to the current Space. New work is personal; historical conversations retain their saved scope when reopened. Existing message rendering preserves attachments, citations, approval actions, retry, cancellation, and copy behavior. The workspace restyles assistant messages as bubbles. Drafts, uploads, recording, and unsaved editor changes participate in navigation guards.

### Details, settings, and history

Details contains a monitor-icon activity tile and truthful links to ongoing work, scheduled tasks, and approvals. It is an activity destination, not a computer preview. Settings retain identity, description, model and advanced agent configuration, personal app assignments, and remembered preferences. Conversation context and existing-conversation model choice remain in settings. Shared Team/Auto mode and companion voice/model options now live in the inline Companion section above the conversation. The previous User/Agent/Team work-mode selector is removed. History shows the account-loaded conversations for the selected agent, without a current-Space filter. Close/back controls stay in the panel header.

### Command search

Search includes agents, account-loaded conversations, and actions for Agent settings, Activity, Connections, and Create agent. The dialog supplies arrow-key/Enter guidance and a no-results state. Its selected result uses the dialog-selection tone. It is not a product-wide launcher or a Marketplace search.

### Fields and state feedback

Workspace form controls declare a visible two-pixel muted focus outline with a three-pixel offset. Disabled controls use the muted text role; send has explicit disabled fill and text variants. Settings fields use the canvas, structural line, and field radius. Shared menu, editor, and transcript components retain their existing semantics. These source declarations and component captures are not comprehensive keyboard, native touch, large-text, or assistive-technology certification.

## Do's and Don'ts

### Do:

- Do preserve the user-pinned Grok structure and Misty identity together.
- Do use the scoped grayscale tokens and existing semantic status treatments where the shared conversation renderer requires them.
- Do retain visible focus, personal new-work scope, saved historical conversation scope, and explicit settings labels.
- Do describe activity, permissions, working states, and failures truthfully.

### Don't:

- Don’t restore a centered hero, roster responsibility subtitles, runtime marketing text, or the replaced User/Agent/Team work-mode selector. Keep the authorized Team/Auto companion controls inline in Agents.
- Don’t add Marketplace to this Agents surface or infer a product-wide removal.
- Don’t turn the activity tile into a simulated live computer stream.
- Don’t treat synthetic component captures as native-shell, voice, backend, or permission-enforcement verification.
