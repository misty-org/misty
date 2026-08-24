# Transfers

**Priority:** P4 operations  
**Depends on:** Files  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Keep Transfers deterministic during normal operation and use Misty only to compress failures, explain conflicts, and propose safe recovery.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Transfers is a substantial queue/history surface with batches, tree/table views, pagination, filters, selection, columns, pause/resume/cancel/retry, conflict policies, performance profiles, bandwidth/checksum settings, notices, and activity integration. Misty can diagnose selected rows and apply only currently valid retry/resume proposals.

## Compared with a full product

It is closer to a transfer manager or sync job monitor than a creative tool. Healthy transfers do not need AI conversation.

## Build next

1. Group repeated failures by likely root cause and affected destination/provider.
2. Explain conflict policies with a concrete before/after preview.
3. Propose reviewed recovery batches and verification steps.
4. Generate a support bundle or issue draft from selected failures.
5. Keep Misty silent when the queue is healthy.

## Production bar

Crash-safe queue persistence, idempotent resume, checksum evidence, cancellation, concurrency limits, partial-file cleanup, provider-specific recovery, accurate progress/speed/ETA, accessibility, and complete audit state.

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

