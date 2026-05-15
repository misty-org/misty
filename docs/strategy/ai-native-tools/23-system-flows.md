# Authentication, installation, updates, and deployment

**Priority:** No ambient AI  
**Depends on:** None  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Keep system-critical setup and recovery deterministic, fast, accessible, and honest; use AI only for optional plain-language explanation after the real error and recovery action are known.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Misty has sign-in/register/invitation flows, account switching, desktop installation/readiness, updater behavior, hosted/self-hosted deployment configuration, and diagnostics.

## Compared with a full product

These are system-critical flows, not collaboration tools.

## Build next

1. Improve deterministic diagnostics and recovery before adding any AI explanation.
2. Preserve exact error codes and support bundles beneath friendly copy.
3. Make account, deployment, and local-data boundaries unmistakable.
4. Never let an agent change deployment, credentials, subscription, update channel, or account deletion state through conversational ambiguity.

## Production bar

Accessible and idempotent account flows, strict account-switch isolation, secure credential handling, signed and rollback-capable updates, validated deployment URLs, recoverable installation, actionable deterministic errors, safe retry behavior, support bundles, and native desktop end-to-end coverage for every critical path.

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
