# Activity and attention

**Priority:** P2 coordination  
**Depends on:** Spaces; Agents  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Activity explain what changed, why it matters, and what needs a decision—while preserving access to the complete unfiltered event stream.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Activity is currently a notification/attention store and popover rather than a route. It merges Space and local activity, deduplicates, tracks unread/attention state, navigates to source objects, synchronizes the native badge, and sends sanitized desktop notifications. Recurring AI recaps exist as a backend/settings concept for Home, Activity, and Global Misty.

## Compared with a full product

It is a focused notification center, not an analytics dashboard or social feed. Its AI role is attention compression.

## Build next

1. Group repeated events into outcome-oriented narratives by Space and object.
2. Add a cited Catch me up view with direct next actions.
3. Explain why an item is considered important and let the user correct ranking.
4. Surface agent waiting/failed/completed states consistently.
5. Deliver configured daily/weekly recaps here or on the relevant Space landing page.
6. Never silently hide or reprioritize the underlying feed.

## Production bar

Deduplication, pagination, durable read state, quiet hours/digests, native notification reliability, source navigation, cross-device sync, accessibility, and explainable ranking.

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

