---
name: Misty Cursor Companion
description: A cursor-following Misty buddy with Clicky signals and shared Agents settings controls.
colors:
  clicky-blue: "#3380ff"
  signal-white: "white"
  controls-text: "var(--color-cream)"
  controls-muted: "var(--color-cream-muted)"
  controls-surface: "var(--color-charcoal-card)"
  control-border: "var(--color-charcoal-border)"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 500
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    lineHeight: "20px"
  shortcut:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
  pointing:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  waveform-bar: "1.5px"
  control: "var(--radius-md)"
  settings-group: "var(--radius-lg)"
  pointing-bubble: "6px"
spacing:
  waveform-gap: "2px"
  setting-gap: "16px"
  controls-inset: "12px 20px 24px"
  row-padding: "16px"
components:
  controls:
    textColor: "{colors.controls-text}"
    typography: "{typography.body}"
    padding: "{spacing.controls-inset}"
  settings-group:
    backgroundColor: "{colors.controls-surface}"
    textColor: "{colors.controls-text}"
    rounded: "{rounded.settings-group}"
  settings-row:
    textColor: "{colors.controls-text}"
    typography: "{typography.body}"
    padding: "{spacing.row-padding}"
  model-trigger:
    textColor: "{colors.controls-text}"
    rounded: "{rounded.control}"
    width: "160px"
  preview:
    size: "80px"
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

## Current interaction update — 2026-09-28

The user has replaced Team/Auto with one natural conversation and task flow.
AgentCompanionPanel now shows an Ask switch (off by default), Cursor, Stop, and
Voice & model. Ask is labeled “Ask before taking control”; its description says
whether Misty asks first or takes control when needed. Both typed and voice work
share the same controller and native desktop task. During desktop takeover a
native bottom strip remains visible across applications; Escape/Stop and the
voice shortcut return control. The old mode-control descriptions and screenshots
below document the earlier design and are not the current interaction contract.

## Overview

**Creative North Star: "Misty at the Cursor"**

The animated Misty cloud follows the cursor, giving temporary voice and pointing feedback in the visual language of Clicky's overlay. The original `src/shared/assets/misty-cloud-expression-cycle.webp` is the companion asset. The overlay and on-demand controls in the Agents Companion sheet form a local companion design; this document does not replace Misty's workspace design system. The overlay-only renderer boots through `companion.html`; controls belong in Agents rather than a tray window. The WebP is imported with `?inline` so the packaged application needs no separate asset request.

The visual authority is `vendor/clicky/leanring-buddy/OverlayWindow.swift`, expressed by the finished `CursorCompanionRoot.tsx`, `cursorCompanion.css`, and `motion.ts`. Preserve its blue waveform, open spinner, pointing bubble, spring following, and curved flights. `AgentCompanionPanel.tsx` and `agentCompanionPanel.css` place a centered sprite preview and shared desktop settings rows in the Agents Companion sheet. The current local UI below supersedes the historical control wording in the interaction update; its native-controller statements remain separate. `companionState.ts` and `CursorCompanionController.tsx` share one mode and control handler with typed and native voice interactions. Controls inherit the Agents system type and theme tokens. The source blue glow and system font are deliberate parts of the approved direction.

**Key Characteristics:**

- One existing animated Misty character asset.
- Transparent cursor overlay with transient blue signals.
- On-demand shared settings rows for visibility, Ask, size, native shortcut, and model.
- Spring following, curved pointing flights, and typed labels.

## Colors

Clicky blue identifies transient activity against a transparent desktop overlay; inherited charcoal and cream tokens support the Agents settings sheet.

### Primary

- **Clicky Blue:** waveform bars, processing gradient, pointing bubble, point marker, and associated glow.

### Neutral

- **Controls Text and Controls Muted:** inherited primary labels, secondary status, explanations, and keyboard focus treatment.
- **Controls Surface and Control Border:** shared settings groups, row separators, select framing, and shortcut border.
- **Signal White:** text within the pointing bubble.

**The Local Palette Rule.** These values belong to the cursor companion; they do not redefine root workspace tokens.

## Typography

System UI type is used throughout the controls and pointing bubble. Body and title roles carry settings labels, status, model controls, and the sheet heading. The smaller label role carries shared Behavior and Voice section headings. The larger shortcut role displays the native talk keys. Pointing text keeps its separate compact medium-weight role.

There is no display face or separate monospace treatment. Shortcut key text inherits the surrounding font. Preserve the existing brief labels and temporary pointing phrases rather than extending the overlay into persistent text content.

## Layout

The overlay fills its display, stays transparent, ignores pointer events, and anchors a zero-size group to the animated cursor position. The character is centered at that anchor and renders at (32 × 32px). Normal following targets the cursor plus (35px, 25px).

A point puts a marker on the exact spot and parks the character beside it. The marker is a (22px) pulsing ring, or the real control's outline padded by (3px) when Accessibility found it. The character's center parks one radius plus (4px) to the right of the marker, half a radius below its middle, and flips to the left side at the display's right edge. It stays one radius plus (4px) inside the display, so it never covers what it points at (`pointLayout.ts`). The bubble sits (10px) right and (18px) below the group anchor with intrinsic text width. The waveform and spinner center on the same anchor as the sprite.

The controls open in the Agents shared nonmodal right sheet (420px), with a header (54px) and independently scrolling content. The existing sprite is centered at the documented preview size with bottom spacing (24px). Behavior and Voice use `DesktopSettingsSection` and `DesktopSettingsRow`; rows have a two-column label/control grid, gap (16px), and minimum height (64px). The size slider spans its own row below its label, percentage, and Reset size action.

The model trigger uses the documented width capped at (100%). Error text wraps anywhere with a (160px) minimum-width text block. The sheet follows Agents container behavior: it replaces the conversation beside the roster below (960px), adapts to the compact roster below (720px), and occupies the full available width below (600px). This surface is available on demand from the pointer button, not a persistent conversation strip or a separate controls window.

## Elevation & Depth

The sheet uses the shared sidebar background without a panel shadow or entrance animation. Shared settings groups use card fill, restrained corners, and thin row dividers. Switches, slider, and select retain their shared state styling. Depth belongs to the overlay's active blue signals. Waveform bars and the processing spinner share a blue glow; the pointing bubble's glow changes with its spring scale and settles to a smaller glow. Exact shadow and animation expressions are recorded in the sidecar.

**The Source Glow Rule.** Retain the Clicky signal glow as implemented; do not spread it across the controls or root workspace.

## Shapes

The character keeps the supplied asset's silhouette and is contained without cropping. Five narrow rounded waveform bars form the listening indicator. Processing uses an open round-capped arc: a (70/30) dash pattern with a (-15) offset on a (14px) circle, inside an (18 × 18px) SVG viewport. Its conic gradient runs from transparent blue to Clicky blue.

The shared model select and icon actions use the control radius and inherited border language. Settings groups use the larger shared radius. The two switches keep their shared pill shape; Stop and Retry use shared ghost buttons, and Reset size uses an IconButton. The pointing bubble is a small rounded rectangle with no speech tail. Controls belong to the Agents sheet; the overlay has no navigation rail or chat container.

## Components

### Character and state signals

The existing animated asset is shown at rest and while responding. Listening fades the sprite out and reveals five waveform bars; processing fades it out and reveals the rotating open spinner. The waveform uses microphone power and a five-bar center-weighted profile, updated at up to (36Hz). Its exact gain, decay, and height formula remain in `motion.ts`.

The group fades visibility over (400ms). Sprite opacity transitions over (250ms); state signals transition over (150ms). These motion values describe the renderer. Packaged macOS observation established visible sprites and Team-to-Auto switching through the native controller; it did not establish voice, multimonitor behavior, or Windows parity.

### Pointing bubble and movement

Following uses a spring with response (0.2s) and damping fraction (0.6). Pointing and return flights use a quadratic curve, smoothstep progress, a duration bounded to (600–1400ms), tangent rotation, and a peak scale of (1.3). The curve lift is bounded to (80px).

After arrival, the bubble types what to do there, one character every (30–60ms). That is the model's label, such as "click Commit", and during a walkthrough it is prefixed with the step ("2 of 4 · click Commit"). The old "right here!" phrases appear only when a label is missing. Completion starts the approximately (3s) hold; the bubble then fades over (500ms) before return. A walkthrough step that waits for a click holds until the target is clicked, the person speaks or types again, or five minutes pass. The marker shows from the outbound flight until the hold ends. Bubble scale uses a (0.4s) spring response. Moving the cursor more than (100px) during return ends the return flight and resumes following. These are implemented behaviors, not a new generic motion system.

### Precise pointing and walkthroughs

A reply's point comes from a downscaled screenshot. Captures stay inside the sizes vision providers keep: a short side of at most (768px) and a long side of at most (1568px). The main window first asks native Accessibility for the actionable control at or near the point, preferring one whose text matches the label (`MistyCompanionPointing.m`). It waits up to (700ms), then snaps to that control and outlines it. When nothing matches, the raw point shows at once. A (280pt) full-resolution crop around it then goes through the reply's own vision model (`POST /me/companion/refine-point/{invocationID}`, metered and bounded to four calls per answer), and the point moves if the refined spot is more than (6pt) away. Neither step presses or focuses anything.

A reply tagged `[GUIDE:k/n]` with k below n is a walkthrough step. While it waits, native forwards left-click positions to the main window, and only then. A click on the outlined control (with (10pt) slack), or within (36pt) of the point when there is no outline, captures the screens again and asks for the next step as a teaching continuation. A step that began as a spoken question is read aloud as well. Pressing the voice shortcut, typing, or Stop ends the wait.

### Controls

The current surface contains the centered existing sprite, Behavior and Voice groups, conditional active status/Stop, and an error/Retry area. Behavior has exactly one Show companion visibility switch, one Ask before taking control switch (off by default), and the full-width Companion size slider with percentage and Reset size. Voice contains the native talk shortcut on macOS/Windows and a shared model Select with Server default plus available models. No Team/Auto group, separate Cursor button, or Voice & model disclosure remains.

Controls use shared Switch, Slider, Select, Button, and IconButton primitives and retain the existing `visibility`, `ask`, `size`, `model`, `stop`, and `retry` command bindings. Visibility, Ask, size, and model controls disable until the control handler is available. Reset also disables at the default size. Stop appears while typed work is active or the voice phase is non-idle. Status shows listening, speaking, or working during activity; unavailable controls show Starting… on native desktop or availability guidance elsewhere. Errors use a separate alert, with Retry companion on native desktop. Shared controls own keyboard and focus behavior; this document does not claim visible focus halos beyond the current shared/global styling.

Current UI evidence is `.impeccable/review/agents-island-final/companion.png` and the same directory's desktop, split-pane, and light-theme captures and README. The production-component fixture establishes settings rendering and state/action wiring, not live native voice, cursor control, or backend execution. Earlier `.impeccable/review/cursor-agents/team.png`, `auto.png`, `narrow.png`, and `packaged-macos-auto.png` are historical rendering/mode-switch evidence only and do not define the current settings UI.

## Do's and Don'ts

### Do:

- **Do** use the current desktop icon as the sole companion asset.
- **Do** preserve the source blue signals, open spinner, spring motion, and typed pointing bubble.
- **Do** mark the exact spot and park the character beside it; the bubble says what to do there.
- **Do** keep the overlay transparent and non-interactive to pointer input.
- **Do** keep controls in the shared Agents Companion sheet with shared settings rows, one visibility switch, Ask, a full-width size slider/reset, model, and native shortcut.
- **Do** scope this design to the cursor companion and leave root workspace tokens intact.

### Don't:

- **Don't** turn the cursor overlay into a sidebar, chat surface, or persistent transcript; the controls belong in the existing Agents page.
- **Don't** replace the existing character with a newly generated mascot or icon.
- **Don't** restore tray controls, the standalone controls window, or User/Agent/Team choices.
- **Don't** extend the packaged macOS sprite and mode-switch observation into voice, multimonitor, or Windows acceptance claims.

## Companion appearance

The Companion sheet exposes Show companion and Companion size (50–200%, default 100%, in 25% increments), with Reset size returning to the default. The settings preview uses the actual sprite at a fixed (80px); the slider controls its desktop appearance. Size applies immediately without interrupting an agent turn and persists alongside visibility and model for the current account on the device. The companion remains beside the pointer and its follow target stays inside the display at every supported size.

### Automatic retreat

When idle, the companion fades away over 400ms after three seconds without meaningful pointer movement. Keyboard activity fades it away over 150ms. Returning after typing requires a 600ms pause followed by at least 10 logical pixels of pointer displacement; movement during typing and small pointer jitter do not wake it. Listening, processing, responding, and pointing retain their feedback. Reduced-motion users get immediate visibility changes.

This transient behavior does not change the saved visibility preference. Native keyboard hooks publish only an activity sequence, never key identities or text. Pointer inactivity hiding continues to work without keyboard monitoring access. Unit and renderer tests cover the visibility rules, and the macOS native build check passes; live desktop interaction and Windows runtime behavior have not been verified for this change.

## Native overlay alignment correction — 2026-09-24

macOS overlays now apply their complete AppKit frame in one main-thread operation, using the same Core Graphics display-point bounds as cursor samples. Previously, positioning the default 600-point window before enlarging it moved the top edge upward; a hidden native-window probe on the current 1496 × 967-point display reproduced a −367-point top edge, while the atomic-frame path produced zero. Origin, size, and cursor samples consistently use display points across scaled displays. Sprite size, follow offset, spring motion, and pointing behavior are unchanged.

Validation: two geometry regressions cover the primary Retina display and secondary displays above, below, left and right at mixed scales; all four native companion tests and nine frontend size/protocol tests pass. The native AppKit probe confirms the positioning correction. This does not constitute a complete multi-monitor hardware or live pointing/voice acceptance run.

### Overlay startup recovery

Native command policy allows display overlays to read `cursor_companion_snapshot`, while still rejecting control, capture, and other host commands. This restores the initial presentation after startup or renderer reload instead of leaving the overlay at its hidden default. Snapshot errors are reported to the main companion controller, and a late snapshot cannot overwrite a newer presentation event. Native policy tests and renderer startup tests cover this path; the running macOS overlay was observed loading its sprite and transitioning from visible to idle-hidden after the fix.

### Failure recovery signal

When a turn fails outside the Agents page, the visible cursor now carries a brief
blue status label directing the user to Agents to retry. Speech failure has its
own label and does not remove a valid point; the status appears after pointing
finishes. Detailed errors and interactive Retry/Stop controls remain in Agents.
This adapts Clicky's transient signal style to Misty's separate controls surface:
an unchanged mascot alone did not communicate an error. The label is not a chat
transcript and does not intercept desktop input. Renderer regression coverage is
in place; final live inspection is blocked while the Mac is locked.
