# Goals, milestones, and roadmaps

**Priority:** P2 coordination  
**Depends on:** Planner; Spaces  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Roadmaps a living model of intent, dependency, and risk that humans and agents can explore together before committing changes to the actual plan.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Misty has roadmap lists, a graph canvas, outline, node definitions, goals, milestones, dependencies, inspectors, autosave, history, version conflict handling, and contextual AI. Current AI writes are deliberately narrow: one revision-anchored title, description, or target-date update to an existing item.

## Compared with a full product

This is a strategic planning graph, not a full portfolio-management suite. It should explain direction and consequences better than a conventional roadmap database.

## Build next

1. Add a versioned graph patch schema for nodes, edges, links, milestones, goals, and layout suggestions.
2. Generate a draft roadmap from a brief with assumptions and open questions clearly separated.
3. Support what-if scenarios in an overlay that never mutates the live graph until accepted.
4. Detect circular dependencies, orphan goals, unowned risks, impossible dates, and stale status.
5. Convert selected graph areas to task proposals and synthesize progress with cited evidence.

## Production bar

Scalable canvas performance, graph validation, conflict-safe batch patches, stable layout, audit history, keyboard/navigation accessibility, exports, and clear separation of current plan versus scenario.

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

