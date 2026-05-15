# Spaces

**Priority:** P0 platform  
**Depends on:** Multi-pane workspace; members and permissions  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make a Space the fastest way to form a mixed human-and-agent team around an objective, with the right tools, permitted context, and first useful plan available within minutes.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

A Space is a permissioned collaborative context containing people, agents, Chat, Journal, Planner, Library, settings, connections, activity, and a persistent dock layout. Space creation, invitations, roles, usage limits, realtime updates, and section permissions are present.

## Compared with a full product

A Space is Misty’s answer to a lightweight combination of a Slack workspace, Notion teamspace, project in ClickUp, and shared agent room. It should not become a database builder or an everything-app container.

## Build next

1. Make Space creation objective-first: name the outcome, participants, time horizon, and initial material.
2. Let Misty propose a starter environment—channels, note, task plan, milestones, and agents—for review.
3. Add a concise Space brief that remains the shared orientation point and cites current work.
4. Give agents first-class membership, roles, presence, and activity rather than hiding them behind commands.
5. Add a Space-level context ledger showing what is shared, indexed, connected, or private.
6. Replace a generic Home dashboard with a useful Space landing/briefing unless user research proves a separate Home is necessary. There is currently no dedicated Home route.

## Production bar

Fast creation, reliable invitations, granular roles, realtime reconnect, offline/read-only behavior, audit history, export/deletion, retention controls, scalable member lists, and a comprehensible empty state for every tool.

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

