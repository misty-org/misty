# Midscene browser execution

> October 4, 2026: desktop browser tasks now run Midscene on the device through
> `browser_act`; see Phase 4 in
> [agent-architecture/BRIEF.md](../agent-architecture/BRIEF.md). The runtime
> integration below remains for paths that grant native input directly.

Misty uses the MIT-licensed `@midscene/core` 1.14.0 visual planner through its
exported `standardPlan` API. This is an execution adapter for the existing agent
runtime, not a separate account, browser profile, or unrestricted desktop agent.

The runtime exposes `misty_browser_act` when the authorized catalog contains
`browser.visual` and the native `browser.interact` schema. The caller supplies
an existing browser scope and a concrete instruction. Navigation and browser
creation continue through the existing authorized browser tools.

Each iteration captures the granted WKWebView, asks Midscene for one action,
validates normalized coordinates and input, then dispatches through the existing
Misty tool journal and device worker. The next iteration captures a new image.
Completion requires a subsequent visual observation, and the supervising agent
receives the final image for review. Each subtask is bounded to 24 actions.
Foreground native agent runs with a validated device/window lease can use up to
120 model turns, including Midscene planning. Other admission paths keep their
existing limits. The budget contract test verifies the hard limit and lease checks.

Midscene owns the visual planning prompt, action selection and response parsing.
The adapter exposes five generic native primitives: click, drag, type, key and
scroll. There are no website-specific recipes or generated JavaScript execution.
The native adapter is macOS-specific in this initial integration.

Inference uses the run's admitted model through Misty's Vercel AI SDK provider.
No separate Midscene API key is required. Each inference requests the execution
budget, reserves usage, and records actual provider usage using the existing
model lifecycle. Planning is a durable workflow step; browser actions remain
separate durable tool calls. Model steps do not automatically retry paid calls.
Approval/device waits, leases, Stop and takeover remain owned by Misty.

Midscene is not enabled for unrestricted operating-system control. WebKit window
input is scoped to the granted browser view. Native action support must be
present in the desktop build as well as the server registry.
Native iframe interaction and password/file controls remain human handoffs.

Verification on October 3, 2026: runtime typecheck and production build passed;
37 focused runtime tests passed. Go schema/classification and Rust native-input
boundary checks passed. The real WKWebView fixture in
`src-tauri/tests/browser_native_input.m` verified trusted clicks, text entry,
plain keys, Command+A replacement and canvas dragging.

Live exercise on October 3, 2026: Midscene drew a recognizable Excalidraw house
with a rectangular body, triangular roof, door and two windows using native
canvas gestures. Both the agent's captured image and an independent desktop
screenshot showed these parts. No manual canvas input was used.

End-to-end acceptance remains pending: the first drawing run exhausted the old
20-turn admission limit; a continuation later lost its native execution lease
and correctly failed instead of claiming success. That continuation also exposed
60–90 second job-discovery delays when push delivery was missed. The old model
limit and mixed-usage aggregation bug are fixed and tested; the historical lease
removal cause and live push-delivery reliability are not yet established. Native
lease diagnostics now distinguish expiry, owner release, handoff revocation and
window destruction. A stopped native event forwarder no longer advertises a
healthy account feed, allowing the authenticated stream fallback.

Repeat acceptance with an uninterrupted agent-owned browser: verify the existing
drawing without edits, confirm a successful terminal invocation, then exercise a
fresh drawing task through successful completion. Automated checks and a visible
partial-run artifact do not substitute for these lifecycle checks.

## Continuation — October 3, 2026, evening

The companion now leaves admitted tasks running after Stop audio, microphone or
overlay errors, retry, and controller teardown. Explicit Stop task still cancels
execution. The continuation passed 65 frontend lifecycle/account-feed/worker tests
and the full frontend TypeScript check. Physical microphone loss during an active
browser task remains a separate live check.

A read-only Excalidraw check (`invocation_c1be64a4-dd21-4ec4-b10d-9892f528787c`)
completed navigation and visual inspection, then exposed a completion parser defect.
The pinned WorkflowAgent returns executed raw receipts in `toolResults`, while its
model step content contains calls before execution. The parser now accepts only a
matching executed receipt for the sole final finish call. Missing, mismatched,
duplicate, malformed, or failed receipts remain unsuccessful; subsequent work
invalidates an earlier report. Thirty focused runtime tests, runtime TypeScript,
and the normal Docker build passed. Only the development runtime was recreated
and health-checked; the historical failed run was not relabeled.

Resume admitted `invocation_051ee31c-8dfe-4ff6-81f2-e5c2971af2f9` in conversation
`conversation_6d1bd2b1-0dd0-480b-89a0-999c095cdf5a`. It captured a fresh visual
observation, reported the rectangular body, triangular roof, door and two windows,
and persisted `invocation.completed`. An independent desktop screenshot matched
that report. No drawing edits were made. Observed queued-to-start times for these
checks were 928, 882 and 532 ms, with no lease loss. This proves read-only completion
and continuation for this run; a fresh drawing task and broader reliability remain
open acceptance requirements.

The next goal turn recovered native UI control and selected the separate task
target using the native menu's keyboard navigation. A fresh drawing task,
`invocation_9abe6fb0-444f-4b0c-a0ad-851f9be59229` (runtime
`wrun_01M42KNVCKR3H128M2PFRNJMMQ`), was admitted in the same conversation. It
requested a new small house and sun in blank space while preserving the existing
drawing. Native navigation, visual observations and interaction jobs completed;
the agent reduced the canvas zoom to 50% and selected drawing tools.

Midscene then received a definitive Vercel AI Gateway rejection requiring a
positive credit balance, including for BYOK requests. The invocation persisted
invocation.failed, and the worker truthfully displayed the failure and paused
controls. An independent native screenshot still showed the original house;
there was no completed new drawing. This failure is provider funding, not evidence
of a native lease loss or a successful drawing. No provider, allowance or billing
policy was changed to bypass it. The owner was asked to restore the Gateway
balance; fresh drawing completion remains open.
