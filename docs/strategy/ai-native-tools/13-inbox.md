# Inbox

**Priority:** P2 context bridge  
**Depends on:** Misty companion; Spaces  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Inbox the controlled bridge from private communication to collaborative work: Misty helps understand and draft privately, then the user explicitly promotes selected commitments into a Space.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Inbox is a unified Gmail/Outlook-style reader with account/folder navigation, thread list/detail, pagination, compose, reply, drafts, sending, and message actions. Misty can read a bounded selected thread, summarize it, identify commitments, inspect attachment metadata, and place a generated reply into the composer without sending.

## Compared with a full product

It is a project-oriented mail lens, not a complete Gmail or Outlook replacement. It should excel at turning external communication into shared context and reviewed commitments.

## Build next

1. Add cited summaries, question coverage, tone controls, and “answer every request” drafting.
2. Parse tasks, dates, decisions, files, and contacts into editable proposals.
3. Let the user choose which extracted items enter which Space; never share an entire thread implicitly.
4. Add cross-thread/provider search with citations and project grouping.
5. Add attachment content only after explicit attachment/inspection with malware and prompt-injection treatment.
6. Keep send as an exact-recipient, exact-body confirmation.

## Production bar

Provider token recovery, pagination, caching, threading fidelity, HTML/plain-text rendering, attachment handling, drafts, recipients, signatures, search, rate limits, offline behavior, and send idempotency.

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

