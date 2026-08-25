# Multi-pane workspace

**Priority:** P0 platform  
**Depends on:** None  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make the workspace a collaborative stage where people and agents can arrange sources and tools around an objective, move context deliberately between panes, and watch work progress without losing place.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Misty already has persistent tabs, split panes, per-Space layouts, focused-pane routing, virtual windows, session restoration, quick open, and an AI host per pane. This is one of the strongest pieces of the product thesis.

## Compared with a full product

It is not a generic window manager. It is the stage where shared Space context and private execution tools coexist with explicit boundaries.

## Build next

1. Add visible pane identity and context boundaries: Shared Space, Private device, Provider, or Attached for this task.
2. Allow dragging an object or selection from one pane into Misty or another tool as a typed reference, not a copied blob of text.
3. Support “open beside,” “compare in split,” and “continue in” as first-class Misty actions.
4. Show where a running agent is working and which pane or object it currently controls.
5. Persist working sets, attached context, and draft proposals across restarts without silently restoring expired grants.
6. Make cross-pane handoffs create provenance links between source and output.

## Production bar

Crash-safe layout restoration, no duplicate tabs after migrations, correct focus and shortcut routing, accessible pane resizing, sensible minimum sizes, performance with several live surfaces, and clear recovery when one pane fails.

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

