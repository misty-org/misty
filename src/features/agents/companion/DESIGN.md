---
name: Misty Cursor Companion
description: A cursor-following Misty buddy with Clicky voice and pointing signals.
colors:
  clicky-blue: "#3380ff"
  signal-white: "white"
  controls-text: "var(--color-cream, #e8e6e3)"
  controls-muted: "var(--color-cream-muted, #aaa8a5)"
  select-surface: "var(--color-charcoal-bg, #151515)"
  control-border: "var(--color-charcoal-border, #2a2a2a)"
  mode-surface: "var(--agent-field)"
  mode-muted: "var(--agent-muted)"
  mode-text: "var(--agent-text)"
  mode-border: "#383838"
  mode-active: "#444444"
  mode-active-text: "#ffffff"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    lineHeight: 1.45
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    lineHeight: 1.45
  pointing:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  waveform-bar: "1.5px"
  control: "5px"
  mode-group: "14px"
  mode-choice: "12px"
  pointing-bubble: "6px"
spacing:
  waveform-gap: "2px"
  field-padding: "5px 8px"
  header-gap: "8px"
  setting-gap: "12px"
  controls-inset: "14px 18px"
  row-offset: "10px"
components:
  controls:
    textColor: "{colors.controls-text}"
    typography: "{typography.body}"
    padding: "{spacing.controls-inset}"
  select:
    backgroundColor: "{colors.select-surface}"
    textColor: "{colors.controls-text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "{spacing.field-padding}"
  mode-group:
    backgroundColor: "{colors.mode-surface}"
    rounded: "{rounded.mode-group}"
    padding: "2px"
  mode-choice:
    backgroundColor: "transparent"
    textColor: "{colors.mode-muted}"
    rounded: "{rounded.mode-choice}"
    padding: "2px 10px"
  mode-choice-active:
    backgroundColor: "{colors.mode-active}"
    textColor: "{colors.mode-active-text}"
    rounded: "{rounded.mode-choice}"
    padding: "2px 10px"
  waveform-bar:
    backgroundColor: "{colors.clicky-blue}"
    rounded: "{rounded.waveform-bar}"
    width: "2px"
  pointing-bubble:
    backgroundColor: "{colors.clicky-blue}"
    textColor: "{colors.signal-white}"
    typography: "{typography.pointing}"
    rounded: "{rounded.pointing-bubble}"
    padding: "4px 8px"
---

# Design System: Misty Cursor Companion

## Overview

**Creative North Star: "Misty at the Cursor"**

The Misty desktop mark follows the cursor, giving temporary voice and pointing feedback in the visual language of Clicky's overlay. The current `src/assets/branding/misty-icon.png` is the sole companion asset, copied from the native desktop icon. The overlay and inline controls in the Agents conversation form a local companion design; this document does not replace Misty's workspace design system. The overlay-only renderer boots through `companion.html`; controls belong in Agents rather than a tray window. The PNG is imported with `?inline` so the packaged application needs no separate asset request.

The visual authority is `vendor/clicky/leanring-buddy/OverlayWindow.swift`, expressed by the finished `CursorCompanionRoot.tsx`, `cursorCompanion.css`, and `motion.ts`. Preserve its blue waveform, open spinner, pointing bubble, spring following, and curved flights. `AgentCompanionPanel.tsx` and `agentCompanionPanel.css` place shared ghost buttons, a Team/Auto radio group, and a native model selector above the conversation. `companionState.ts` and `CursorCompanionController.tsx` share one mode and control handler with typed and native voice interactions. Controls inherit the Agents system type and theme tokens. The source blue glow and system font are deliberate parts of the approved direction.

**Key Characteristics:**
- One existing animated Misty character asset.
- Transparent cursor overlay with transient blue signals.
- Inline Agents controls with Team/Auto choices and expandable voice/model options.
- Spring following, curved pointing flights, and typed labels.

## Colors

Clicky blue identifies transient activity against a transparent desktop overlay; inherited charcoal and cream tokens support the inline Agents controls.

### Primary
- **Clicky Blue:** waveform bars, processing gradient, pointing bubble, and associated glow.

### Neutral
- **Controls Text and Controls Muted:** inherited primary labels, secondary status, explanations, and keyboard focus treatment.
- **Select Surface and Control Border:** inherited native select framing and the panel's bottom divider.
- **Mode Surface, Mode Muted, and Mode Text:** the Agents mode group and its idle/hover labels.
- **Mode Border, Mode Active, and Mode Active Text:** the outlined group and visibly selected Team/Auto choice.
- **Signal White:** text within the pointing bubble.

**The Local Palette Rule.** These values belong to the cursor companion; they do not redefine root workspace tokens.

## Typography

System UI type is used throughout the controls and pointing bubble. The body role carries inline action labels; the smaller label role carries help, shortcuts, status, and the model field. The title role belongs to the inline Companion heading. Pointing text has its own compact medium-weight role.

There is no display face or separate monospace treatment. Shortcut key text inherits the surrounding font. Preserve the existing brief labels and temporary pointing phrases rather than extending the overlay into persistent text content.

## Layout

The overlay fills its display, stays transparent, ignores pointer events, and anchors a zero-size group to the animated cursor position. The character is centered at that anchor and renders at (32 × 32px). Normal following targets the cursor plus (35px, 25px).

A point target offsets the supplied coordinate by (8px, 12px), clamps to a (20px) display inset, and receives a curved outbound flight. The bubble sits (10px) right and (18px) below the group anchor with intrinsic text width. The waveform and spinner center on the same anchor as the sprite.

The inline panel is a non-shrinking section above the conversation's scroll region, with the frontmatter inset and a bottom divider. Its (32 × 32px) character, title/status, Cursor on/off action, and conditional Stop action share a wrapping top row. The title has a (110px) minimum width. A second wrapping row carries Team/Auto and a mode explanation with a (180px) minimum width. Voice & model expands in place below, followed by any error and Retry companion action.

The native model select has no minimum width and a maximum width of (100%). Error text wraps anywhere with a (160px) minimum-width text block. The panel uses flex wrapping without defining a new breakpoint; existing Agents container rules still apply to its buttons. This is an inline section, not a separate full-height controls window.

## Elevation & Depth

The inline panel uses its host background and a thin bottom border, without a panel shadow. The selected mode choice has the existing small structural shadow (0 1px 2px rgba(0, 0, 0, 0.2)). Depth belongs to the overlay's active blue signals. Waveform bars and the processing spinner share a blue glow; the pointing bubble's glow changes with its spring scale and settles to a smaller glow. Exact shadow and animation expressions are recorded in the sidecar.

**The Source Glow Rule.** Retain the Clicky signal glow as implemented; do not spread it across the controls or root workspace.

## Shapes

The character keeps the supplied asset's silhouette and is contained without cropping. Five narrow rounded waveform bars form the listening indicator. Processing uses an open round-capped arc: a (70/30) dash pattern with a (-15) offset on a (14px) circle, inside an (18 × 18px) SVG viewport. Its conic gradient runs from transparent blue to Clicky blue.

The native model select uses the control radius and inherited border. Team/Auto uses a rounded group with inset rounded choices. Cursor, Stop, and Retry use shared ghost buttons. The pointing bubble is a small rounded rectangle with no speech tail. The panel is part of the Agents conversation; the overlay has no navigation rail or chat container.

## Components

### Character and state signals

The existing animated asset is shown at rest and while responding. Listening fades the sprite out and reveals five waveform bars; processing fades it out and reveals the rotating open spinner. The waveform uses microphone power and a five-bar center-weighted profile, updated at up to (36Hz). Its exact gain, decay, and height formula remain in `motion.ts`.

The group fades visibility over (400ms). Sprite opacity transitions over (250ms); state signals transition over (150ms). These motion values describe the renderer. Packaged macOS observation established visible sprites and Team-to-Auto switching through the native controller; it did not establish voice, multimonitor behavior, or Windows parity.

### Pointing bubble and movement

Following uses a spring with response (0.2s) and damping fraction (0.6). Pointing and return flights use a quadratic curve, smoothstep progress, a duration bounded to (600–1400ms), tangent rotation, and a peak scale of (1.3). The curve lift is bounded to (80px).

After arrival, a short pointing phrase types one character every (30–60ms). Completion starts the approximately (3s) hold; the bubble then fades over (500ms) before return. Bubble scale uses a (0.4s) spring response. Moving the cursor more than (100px) during return ends the return flight and resumes following. These are implemented behaviors, not a new generic motion system.

### Controls

The inline Companion heading and live status, Cursor on/off ghost button, Team/Auto choices, conditional Stop button, Voice & model disclosure, native model selector, and error/Retry area form the controls surface. The cursor action and shortcut help appear on native macOS/Windows. Mode and model controls disable until the shared control handler is available. Status distinguishes starting, ready, listening, working, speaking, and desktop-voice availability; errors use a separate alert. Stop appears while a typed task is working or the voice phase is not idle.

Team/Auto is a radio group with a single Tab stop on the selected choice. Arrow keys switch choices; Home selects Team and End selects Auto while moving focus. Shared mode changes flow through the controller. The panel and Agents workspace declare visible (2px) focus outlines with (3px) offsets. The mode group's source hover brightens its label, and its active choice uses the recorded fill and shadow. Shared ghost buttons retain their existing shared button states.

Evidence includes `.impeccable/review/cursor-agents/team.png`, `auto.png`, and `narrow.png` renderer captures, plus `packaged-macos-auto.png` from the actual packaged macOS app. The latter shows rendered original sprites and Auto selected; the observed Team-to-Auto action used the native controller. This evidence is bounded to rendering and mode switching.
## Do's and Don'ts

### Do:
- **Do** use the current desktop icon as the sole companion asset.
- **Do** preserve the source blue signals, open spinner, spring motion, and typed pointing bubble.
- **Do** keep the overlay transparent and non-interactive to pointer input.
- **Do** keep controls inline in Agents, with keyboard-operable Team/Auto choices and expandable voice/model options.
- **Do** scope this design to the cursor companion and leave root workspace tokens intact.

### Don't:
- **Don't** turn the cursor overlay into a sidebar, chat surface, or persistent transcript; the controls belong in the existing Agents page.
- **Don't** replace the existing character with a newly generated mascot or icon.
- **Don't** restore tray controls, the standalone controls window, or User/Agent/Team choices.
- **Don't** extend the packaged macOS sprite and mode-switch observation into voice, multimonitor, or Windows acceptance claims.

## Companion appearance

Agent settings exposes Show cursor companion and Companion size (50–200%, default 100%, in 25% increments). The size control previews the actual sprite, applies immediately without interrupting an agent turn, and persists alongside visibility and model for the current account on the device. The companion remains beside the pointer and its follow target stays inside the display at every supported size.

## Native overlay alignment correction — 2026-09-24

macOS overlays now apply their complete AppKit frame in one main-thread operation, using the same Core Graphics display-point bounds as cursor samples. Previously, positioning the default 600-point window before enlarging it moved the top edge upward; a hidden native-window probe on the current 1496 × 967-point display reproduced a −367-point top edge, while the atomic-frame path produced zero. Origin, size, and cursor samples consistently use display points across scaled displays. Sprite size, follow offset, spring motion, and pointing behavior are unchanged.

Validation: two geometry regressions cover the primary Retina display and secondary displays above, below, left and right at mixed scales; all four native companion tests and nine frontend size/protocol tests pass. The native AppKit probe confirms the positioning correction. This does not constitute a complete multi-monitor hardware or live pointing/voice acceptance run.
