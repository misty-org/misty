# Space Chat

**Priority:** P1 collaborative core  
**Depends on:** Spaces; Misty companion  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Chat the shared conversation-to-action layer where people and agents reach decisions, create durable work, and retain evidence without losing the natural flow of discussion.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Space Chat supports conversations, replies, editing, reactions, attachments, mentions, presence, direct-message framing, external channel links, agent runs, typing state, suggestions, and a contextual adapter. Misty can recap, extract actions, explain a thread, and draft a message into the composer.

## Compared with a full product

It is a project conversation surface, not a full Slack or Discord replacement. Its advantage should be converting discussion into durable work while humans and agents remain visible participants.

## Build next

1. Let users select a message range and ask for a cited recap, decision log, unresolved questions, or reply.
2. Turn extracted tasks/events/notes into editable cards before creation and link them back to source messages.
3. Allow @Misty and @Agent mentions with visible plan, progress, and handoff states inside the thread.
4. Add “catch me up since…” and participant-specific summaries.
5. Let Misty notice a concrete agreement, but only surface a reviewable nudge—never create work silently.
6. Add scheduled recaps only when configured by a Space owner.

## Production bar

Reliable ordering and pagination, unread markers, search, thread navigation, attachment safety, moderation/retention, offline drafts, rate limits, notification controls, reconnect behavior, and source-preserving integrations.

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

