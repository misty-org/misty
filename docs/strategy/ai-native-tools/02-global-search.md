# Global Search and launcher

**Priority:** P0 entry point  
**Depends on:** Misty companion; multi-pane workspace  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Let a user find anything, assemble exact context, and turn intent into a visible answer, native proposal, or delegated task from one keyboard-first entry point.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

The current Global Misty UI is primarily a fast Search/launcher experience. It combines server and local results, knows the active route and selected Files items, supports context chips, opens results in the correct surface, and exposes commands. The earlier Search/Ask/Action concept is not presently a complete unified interaction.

## Compared with a full product

Today it resembles Spotlight or Raycast with Misty-specific objects. A full Misty version should become the cross-tool intent router and context assembler, not another general chat screen.

## Build next

1. Preserve instant lexical search; never wait for a model before showing results.
2. Add permission-aware semantic retrieval and grounded answers above results with source links.
3. Support multi-select context and verbs such as Compare, Summarize, Open together, Add to Space, and Delegate.
4. Turn the flow into a progression: result → context → answer → proposal → action/run.
5. Add deterministic intent handling for routes, URLs, file paths, and known commands before model routing.
6. Let the user open selected results into adjacent panes as a working set.

## Production bar

Sub-100 ms local feedback, resilient offline/local search, complete keyboard navigation, stable ranking, deduplication across sources, permission-filtered retrieval, citations that open the exact object, and no raw local path leakage.

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

