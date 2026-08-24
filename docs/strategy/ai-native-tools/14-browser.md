# Browser

**Priority:** P2 execution bridge  
**Depends on:** Misty companion; multi-pane workspace  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Browser the safest place to research and complete bounded web actions with Misty in the user’s real session, with page-level citations and visible control at every step.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Browser has native per-tab webviews, an omnibox, local history, navigation, reload, downloads/notices, viewport simulation, page annotation, and scoped agent grants. Misty can perform a one-time bounded page inspection, summarize/explain/extract, and apply one validated navigation or click using opaque references. Native Browser has its own companion injection path.

## Compared with a full product

It is a research and bounded-action browser, not a secure replacement for Chrome or Safari. It should support real signed-in work while making AI access unusually explicit and revocable.

## Build next

1. Add selection-level Ask/Explain/Translate/Save and exact DOM-range context.
2. Turn annotations and region captures into cited research context.
3. Support multi-tab research sessions with source cards, claim citations, and a reusable research Note.
4. Expand capabilities separately for form fill, tab switching, screenshot, and controlled download; never introduce one generic browser-write grant.
5. Show Observe/Act mode, current grant, expiry, next action, Stop, and Take over.
6. Build compatibility handling and external-browser fallback into the normal flow.

## Production bar

Isolation, cookie/session safety, downloads, popups, permissions, certificates, crashes, memory suspension, accessibility, web compatibility, prompt-injection defense, action confirmation, and thorough native desktop E2E coverage.

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

