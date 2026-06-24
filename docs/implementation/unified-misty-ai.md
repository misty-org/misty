# Unified Misty AI — implementation and verification

Implemented across `misty`, `misty-apps`, `misty-sdk`, and `misty-server`. No database history or saved workflow data is deleted. The workspace task retains ownership of layout changes.

## Experience

- Search owns retrieval state (`Cmd+K`). Choosing Continue with Misty hands off the query. Basic server search does not implicitly call an embedding model.
- Misty owns conversation state, submissions, streaming and context (`Cmd+Shift+K`). Desktop uses the existing independently sized, always-on-top character window; web uses the same conversation controller.
- Agents opens a private activity dashboard, including results, tool summaries, delegation, cancellation, tool approvals and links to conversations. Old automation URLs open this dashboard; workflow infrastructure/data remain intact.
- App selection actions and browser context menus hand off to Misty. Code's independent provider/settings and rewrite controller, the old Agents chat mount, and proactive pane nudge UI are removed. Journal selection actions retain an entry point and use central proposal review.

## Context and access

- Context consumes the finalized Space / virtual-window / layout-tab / pane / app-view identities. Historical app views are excluded. Containers follow current live contents and are copied for each submission. Stable pane and tab attachments survive moves; closed targets fail explicitly.
- Window/tab references are frozen source manifests. They describe a search scope without loading every document. Inactive panes without a live adapter report that content is unavailable until opened. Explicit selections retain content hashes and revisions.
- A host context broker serves the companion. Account checks, exact artifact IDs, current source identity/revision checks and apply/undo stay at the host boundary. Native handoffs have acknowledgements and timeouts.
- Desktop submission checks local Agents package readiness and selected-Space installation. Server invocations, visual search, explicit semantic search, legacy conversation turns and artifact acceptance recheck Space authorization. Unscoped completion is retired.
- Revocation cancels affected work, queues runtime cancellation, clears pending approvals/contexts/reservations and revokes SDK execution capabilities while retaining journals.
- Automatic invocation delegation uses the existing creator-run harness. Parent invocation links remain private and share cancellation. Creation locks the parent and preserves the existing maximum three children and depth-two limits and app capability ceilings.
- External screen context is opt-in, one ScreenCaptureKit window screenshot per submission on macOS 14+. It excludes Misty, preserves drafts on failure, and has an Off control. ScreenCaptureKit is weak-linked for macOS 12 support. Permission/capture errors are visible.

## Verification

Passed during implementation:

- Focused frontend tests: 75 tests, followed by the expanded context, handoff, account-isolation and dashboard suite (24 tests).
- TypeScript checking.
- SDK build/typecheck and 94 tests; packed SDK consumer verification.
- Official Agents, Code and Journal package builds.
- Focused Go HTTP API and Postgres package tests.
- Rust checking and native executable linking; desktop frontend build and macOS app bundle creation.

Incomplete environmental validation:

- Native UI inspection repeatedly timed out, including when targeting the built `.app`. Main-window minimization, external-app captures, full-screen Spaces and multiple monitors have not been verified interactively.
- New database integration test `test/integration/mistyai/unification_test.go` cannot reset the configured test database: permission denied for `smart_library_batches`. It has not exercised the new SQL against PostgreSQL yet.
- The broader server `test/unit` package does not compile because old action-suggestion tests reference removed APIs.
- Updater archive signing fails without `TAURI_SIGNING_PRIVATE_KEY`; no release has been published.
- Focused lint is clean outside the existing Agents RPC transport's four import/network-boundary violations.

These blockers must be resolved before treating the work as release-validated. Stored histories and unrelated in-progress changes have been preserved.
