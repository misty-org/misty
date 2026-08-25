# Agents page

**Priority:** P1 managed work log  
**Depends on:** Misty companion; Spaces; members and permissions  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Agents the durable work log for one user-facing Misty, with background delegation hidden behind clear status, approvals, and results.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

The page is a single Misty workspace with one composer and durable conversations. Model, reasoning, run-mode, voice-persona, and custom-agent configuration are retired. Misty can coordinate bounded hidden workers, and connected MCP tools are available through the managed runtime with approvals and auditing.

## Compared with a full product

It should not imitate an AI marketplace or a developer-only orchestration dashboard. It is the work log for what Misty is doing, what needs approval, what finished, and what failed.

## Build next

1. Add filters for active, waiting, completed, failed, scheduled, and canceled work.
2. Expand replayable activity with context receipts, tool calls, artifacts, cost, sources, and final effects.
3. Add notification and retry affordances for stalled or failed work.
4. Keep background-worker detail collapsed by default while preserving its audit lineage.

## Production bar

Plain-language permissions, least privilege, revocation, audit export, schedules/triggers, budgets, rate limits, managed versioned instructions, tool-health states, retry/cancel, secure credentials, and clear separation between Misty and its hidden background workers.

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
