# Members, connections, permissions, and Settings

**Priority:** P0 trust foundation  
**Depends on:** Spaces; Misty companion; Agents  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make access, sharing, automation, retention, cost, and agent behavior understandable enough that a user can predict what Misty will see and do before it happens.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Space management includes invitations, roles, granular permission groups, human and agent members, Space details, usage, suggestions, and connections for services such as Notion, Slack, Discord, Google Calendar, GitHub, Figma, and mail providers in their relevant surfaces. App Settings includes General, Appearance, Notifications, Files, Search, Browser, Terminal, Code, Transfers, Extensions, Agents, Misty, Models, Privacy, Shortcuts, Updates, and Advanced/deployment controls. Misty settings already expose the master switch, cursor companion, retention, provider/usage, per-surface proactive controls, pinned agents, and scheduled briefings.

## Compared with a full product

This is Misty’s trust and policy layer. It should be as legible as a consumer settings app while enforcing controls expected from serious collaboration and agent platforms.

## Build next

1. Add a “What Misty can access now” dashboard for active Space, browser, file, provider, terminal, and agent grants.
2. Show personal versus shared context and temporary versus persistent access.
3. Add permission presets with an advanced exact-capability view.
4. Add connection health, last use, scopes, affected Spaces/agents, and one-click revocation.
5. Consolidate duplicated AI/Agent settings into one understandable policy hierarchy.
6. Use Misty to explain settings and permission consequences, but never let AI alter security, billing, deployment, or retention controls without exact deterministic confirmation.

## Production bar

Permission enforcement on the server, audit logs, session/device management, secure credential storage, data export/deletion, billing/usage accuracy, self-hosted parity disclosures, accessibility, and safe defaults.

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

