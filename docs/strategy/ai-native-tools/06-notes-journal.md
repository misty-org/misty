# Notes / Journal

**Priority:** P1 collaborative core  
**Depends on:** Spaces; Misty companion  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Notes the best place to think and write with people and AI in the same document, with inline collaboration, source-aware synthesis, and clean reversible authorship.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Notes is a collaborative TipTap/Yjs editor with native Space notes, Notion reading/publishing, search, tags, backlinks, source status, and selection-aware AI. Selected text can be improved, shortened, clarified, summarized, or converted into proposed tasks. Text patches are hash- and revision-checked and can be undone.

## Compared with a full product

It is currently a collaborative project notebook rather than full Notion or Google Docs. That is the correct scope. Misty does not need databases, websites, and every publishing workflow before the writing collaboration is excellent.

## Build next

1. Show AI suggestions as tracked inline proposals adjacent to the selection—not only in the floating companion.
2. Support Replace, Insert below, Apply pieces, Retry, and Discard with a visible diff.
3. Stream longer generation into a temporary block the user can edit while Misty continues.
4. Add page-level outline, decisions, tasks, questions, tags, and “turn this into” actions.
5. Add source-backed AI blocks for living briefs and status sections.
6. Let a user and Misty co-edit during generation without replacing concurrent collaborator changes.
7. Attribute AI-authored transactions and link extracted tasks/events to exact note ranges.

## Production bar

Robust collaborative undo/history, comments, mentions, permissions, autosave/offline recovery, import/export fidelity, large-document performance, mobile/tablet editing, accessibility, and conflict-safe range patches.

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

