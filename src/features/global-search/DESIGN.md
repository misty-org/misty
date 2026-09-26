---
name: Misty Overlay
description: A compact, input-first overlay within the established Misty workspace system.
---

# Design System: Misty Overlay

## Overview

**Creative North Star: "The Quiet Operating Desk"**

This guide covers the docked desktop Misty overlay, including its upper composer and detached bottom controls. Inherit tokens, shared primitives, and product constraints from the root [DESIGN.md](../../../DESIGN.md) and [PRODUCT.md](../../../PRODUCT.md). This is a scoped refinement of that system; the separate search launcher and Agents workspace keep their own composition.

The overlay is an Operate surface. A person starts with the message field, switches the active agent from its name, and reveals thinking choices only when needed. The confirmed direction preserves the incumbent dark desktop identity and reduces setup around the input. It does not establish a replacement product identity or a native mobile layout.

**Key Characteristics:**

- One upper shell for the composer, optional thinking row, approvals, and conversation.
- An input-led hierarchy with quiet icon controls and a compact agent identity.
- Automatic current-view context and a detached bar containing only execution controls.

Source authority is `GlobalMisty.tsx`, `GlobalMistyChrome.tsx`, `MistyComposer.tsx`, `MistyAgentPicker.tsx`, `MistyModelPicker.tsx`, `MistyOverlayControls.tsx`, `../misty/MistyContextBar.tsx`, and `../agents/WorkspaceAutopilotBar.tsx`.

## Colors

Use the inherited theme-bound charcoal surfaces, structural borders, cream text, and muted labels. Agent avatars provide identity; the active agent name and selected menu checkmark communicate selection without adding an accent color. Shared attachment, recording, and approval feedback retain their implemented states; these do not establish new overlay palette tokens.

## Typography

Use the inherited native system family. The message field leads with body text (16px, 24px line height); the active agent name uses semibold type (14px). Thinking choices, secondary labels, and conversation metadata use compact text (12px). Establish hierarchy through position, weight, and brightness, without a display heading.

## Layout

The upper surface is centered, capped at (600px), and inset horizontally by (16px). It begins (40px) below the viewport top and is bounded by the viewport height. Order: agent identity/header actions, message field, composer actions, optional thinking row, approval or artifact review and notices, then conversation.

Keep the agent-name switcher at the left of the header, with history, new conversation, and close at the right. The message field has a minimum height of (80px). Place icon-only attachment and thinking-options triggers at the left of its action row, with split microphone controls and send at the right. Their accessible names carry the action labels.

Thinking options expand beneath the composer into one flat label/value row, with their own scroll limit (40dvh). Conversation content scrolls separately. At narrow desktop widths, preserve this hierarchy, truncate long agent and conversation names, allow supported approval rows to wrap, and keep both floating surfaces within the viewport.

The bottom bar is centered (16px) above the viewport edge, fits its controls, and is bounded by the viewport width minus (32px). Its only visible content is the available playback/chat controls.

**The Input-First Rule.** Thinking choices follow one icon disclosure; configuration must not become a persistent row of competing dropdowns above the message field.

**The One-Shell Rule.** The upper overlay owns its structure and the detached bottom bar owns one background; neither contains a second decorative shell.

## Elevation & Depth

Both surfaces float above the workspace and use the existing restrained shadow treatment. The upper shell owns its depth; the embedded composer removes its own border and shadow. Separate thinking options, approvals, and conversation with hairlines rather than nested cards. Menus use the shared floating-menu treatment. Preserve reduced-motion support for the overlay's opacity transition.

## Shapes

Use a restrained rounded upper shell (12px) and compact bottom bar (8px), retaining the shared controls' shapes. The bottom bar has one background and a small inset (4px); its internal control group has no styled container.

## Components

- **Composer:** Reuse `Button` and the attachment menu. The plus trigger offers files and region capture when capture is available; otherwise retain the direct attachment action. Keep attachment and thinking-options triggers icon-only, with accessible names and the options trigger's expanded state. Preserve attachment previews, disabled send, and existing keyboard submission behavior.
- **Agent switcher:** Make the header's active agent avatar, name, and chevron one trigger. Its menu lists enabled agents created for the account and marks the selected agent. Keep long names bounded. Loading and errors belong in the menu; switching is unavailable while work or an execution is active. Do not turn the header into an agent setup form.
- **Thinking options:** Reuse shared buttons for only Normal and Deep thinking, with the selected choice exposed through `aria-pressed`. The compatibility component `MistyModelPicker` now presents thinking presets, not model or provider selection. Model choice remains server-managed; the presets map to high and xhigh effort. Keep those implementation labels out of the visible control. Disable changes while saving or working and show save failures beside the choices.
- **Voice:** The microphone icon starts recording and changes to a stop control during recording. Its adjacent chevron opens the input-device menu; opening that menu must not start recording. Preserve recording, permission-request, and transcription restrictions, plus accessible names on both controls.
- **Context and apps:** The overlay uses the current view automatically; users express another destination in the prompt. Do not add manual Space, screen, or workspace-context selectors. Installed and connected apps follow the automatic availability path, subject to existing capabilities and permissions; the overlay has no per-agent assignment setup. `MistyContextBar` is reserved for artifact review, undo, handoff notices, and errors, not context configuration.
- **Approval review:** Show the proposed action, summary, and Approve/Deny actions in the upper surface. A pending approval keeps that surface available even when the conversation is closed. Approval errors stay beside the decision.
- **Bottom controls:** Idle controls expose disabled resume/pause plus close. Active execution exposes show chat, resume, pause, and stop/done, with availability reflecting execution state. Preserve accessible names and the screen-reader status; do not add visible explanatory text.
- **Failures:** Execution failures propagate through Misty's existing error/activity path. They do not grow a second message panel inside the bottom bar.

## Do's and Don'ts

### Do:

- **Do** reuse the established theme and shared primitives before introducing custom controls or values.
- **Do** retain accessible action names, pressed/expanded states, working-state restrictions, and explicit approval decisions.
- **Do** keep agent switching in the header, thinking choices beneath their disclosure, and input-device selection beside the recording control.
- **Do** keep the bottom bar at its content width with one background.

### Don't:

- **Don't** restore stacked toolbars, nested decorative cards, repeated dropdown triggers, or explanatory bottom-bar copy.
- **Don't** restore a model/provider picker, manual context controls, or per-agent app-assignment setup in the overlay.
- **Don't** add visible Attach or Options text beside their compact icon triggers.
- **Don't** apply this overlay composition as a new product-wide visual identity.

The finish review used actual isolated component fixtures captured in `.impeccable/review/desktop.png`, `thinking.png`, `agents.png`, `microphone.png`, and `mobile.png`; disposition was ship, with no material fixes. The file named `mobile.png` is a (375px) narrow desktop-browser viewport, not native mobile or touch evidence. The authority was the precise refinement brief and incumbent design, with no approved comp. These captures do not verify the live full application, backend execution, native desktop capture, or native mobile behavior.

Shared attachment drag/upload colors and recording/error colors are preserved local states, not new palette guidance. This scoped refresh inherits the root token frontmatter and sidecar; it does not regenerate either root artifact.
