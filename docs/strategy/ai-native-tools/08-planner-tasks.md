# Planner: tasks

**Priority:** P1 collaborative core  
**Depends on:** Spaces; Misty companion  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Planner the place where people and agents turn intent into an executable, evidence-backed plan and continuously renegotiate that plan as reality changes.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Planner has board/list/calendar views, filters, assignees for people and agents, task drawers, Markdown details, activity, shortcuts, and calendar publishing. Misty currently sees the active task plus filter metadata and can summarize status, identify risks, or propose a task set. It does not yet hydrate the full visible task set in the client adapter, and rich plan editing remains limited.

## Compared with a full product

It is a focused project planner rather than ClickUp, Asana, or Jira. It should optimize the path from shared intent to owned, realistic work instead of accumulating every project-management configuration.

## Build next

1. Return editable task-set proposals with titles, descriptions, owners, dates, dependencies, and source evidence.
2. Support selection and bulk actions: break down, clarify acceptance criteria, estimate, assign, reschedule, merge duplicates, and draft status.
3. Add dependencies, subtasks, effort/duration, structured acceptance criteria, and batch mutation APIs.
4. Let Misty explain why a task is risky using workload, dependencies, dates, and recent activity.
5. Add human/agent workload views and never guess an ambiguous assignee.
6. Connect created tasks back to Chat, Notes, Browser, email, or drawings that produced them.

## Production bar

Fast large boards, reliable filtering/sorting, permissions, recurring tasks if required by the target user, conflict-safe batch changes, imports/exports, notifications, activity history, keyboard operation, and deterministic date/time handling.

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

