# Agenda and Calendar

**Priority:** P2 coordination  
**Depends on:** Planner; Spaces  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Agenda the shared time-negotiation surface where Misty explains constraints and proposes realistic schedules without taking control of anyone’s calendar.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Agenda supports day/week/month-like ranges, zoom, native tasks/events, roadmap items, source visibility, Google Calendar connections, and reviewed event/task artifacts. Misty can brief the visible range, find conflicts, suggest a plan, draft an event, or draft preparation tasks.

## Compared with a full product

It is a Space commitment view, not a replacement for Google Calendar or Fantastical. Its advantage is connecting project commitments to tasks, goals, messages, and agents.

## Build next

1. Hydrate visible event/task details for grounded conflict and preparation analysis.
2. Parse selected text, email, chat, webpages, and notes into reviewed event cards.
3. Propose focus blocks for flexible work and show exactly which constraints prevent a plan from fitting.
4. Support attendee-aware time suggestions when permissioned free/busy data exists.
5. After rescheduling, propose downstream task/date updates and reviewed messages to affected people.

## Production bar

Timezone/DST correctness, recurring events, all-day events, conflict handling, provider reconciliation, offline cache, accessibility, drag/resizing reliability, explicit publishing, and no silent external calendar changes.

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

