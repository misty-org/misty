# Misty companion and global control

**Priority:** P0 differentiator  
**Depends on:** None  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Misty a dependable ambient collaborator: present when invited, context-aware without being invasive, instantly reachable through a stable toggle, and able to make visible, reversible changes in the active tool.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Misty can persist across panes, follow the pointer, attach a region capture, read a surface selection, show suggested actions, stream work, request approval, expose Undo, switch between the built-in Misty and personal agents, and link completed work to durable task history. The current interaction still treats the moving blob as a button, while the navbar control, follow state, composer state, and “go away” behavior are not one simple contract.

## Compared with a full product

This is not merely a chat widget or command palette. It is the system-wide collaboration layer—closer to a combination of Spotlight, an AI command bar, a visible agent presence, and a permissioned action runtime.

## Build next

1. Implement one explicit state model: **Off → Follow → Engaged → Acting → Follow**.
2. Make the moving blob click-through and nonessential. The navbar button and global shortcut toggle the stable composer.
3. Freeze or anchor the composer in a predictable location while engaged; Escape closes it but preserves Follow.
4. Show a context receipt before submission: surface, object, selection, capture, privacy boundary, and named agent.
5. Let selection and capture update the receipt while Follow is active without automatically opening the composer.
6. Allow proactive behavior only as a quiet, dismissible nudge with a reason, cooldown, snooze, and per-surface control. Never auto-open or auto-act.
7. Add a persistent action tray for previews, approvals, progress, errors, and Undo so important controls do not depend on a speech bubble disappearing on a timer.
8. Test the same behavior in React surfaces and native Browser webviews.

## Production bar

Keyboard-only invocation, reduced-motion behavior, coarse-pointer behavior, screen-reader state announcements, no stolen clicks, no silent context expansion, reliable task resumption after navigation/restart, cancel latency under one second, and deterministic recovery from stale artifacts.

## Required thread outputs

1. A current-code audit that confirms or corrects this brief.
2. A staged implementation plan with dependencies and explicit non-goals.
3. The coherent product slice implemented in that thread, with proportional tests.
4. Desktop-specific verification when native behavior, pointer behavior, captures, webviews, files, PTYs, or OS integration are involved.
5. A concise handoff listing completed behavior, remaining gaps, risks, and the next recommended slice.

## Shared acceptance gate

- The underlying tool remains dependable without AI.
- Context sent to Misty is visible, bounded, removable, and permission-correct.
- AI output becomes a native artifact or native proposal rather than copy/paste text.
- Consequential changes are previewable, conflict-checked, attributable, and recoverable.
- The interaction works with keyboard navigation and respects reduced motion where applicable.
- Failures, stale state, cancellation, navigation, and restart behavior are intentionally handled.

