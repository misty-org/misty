# Space-owned apps implementation status

Updated 2026-09-09. **Incomplete; do not deploy this breaking update.**

The work spans the desktop checkout and its adjacent `misty-server`, `misty-sdk`, and `misty-apps` repositories. Changes are uncommitted. No deployment or production reset has been performed. The migrations were applied only to a disposable local PostgreSQL container.

## Implemented

- Space installations, shared ordering, removal/restoration, authority generations, and `apps.manage` delegation.
- Space-scoped installation and runtime-session HTTP routes; old user-installation routes are no longer mounted.
- SDK installation verification, publisher continuity across managers, member provider registrations scoped to Space, and runtime target authorization using Space installations.
- Invalidation of app sessions, SDK provider registrations/targets, and dependent SDK invocation cancellation requests. Social removal also cancels pending outbound commands and schedules and pauses automation rules; delivery rechecks installation availability.
- Journal list/create/direct access gates, app ownership checks in central task/message/Library permission checks, and filtering for server retrieval and local search.
- Private app records and local SDK storage scoped to member, deployment (local storage), Space, and app. Personal connected-account selection and filtering for app-originated connected-account reads.
- Desktop official packages stored under separate checksum-addressed release directories. Logical app removal does not delete package bytes or Space content.
- Space-aware app state, shared sidebar order, local personal pins, removal handling, empty-Space Home messaging, Manage apps settings, and permission controls.
- Unified onboarding/creation UI with editable curated app selections, reviewed permission versions, transactional conditional seeds, and idempotency keys.
- Personal template list/create/rename/replace/delete APIs and setup-only capture. Official-app template creation works; unresolved third-party IDs are blocked before submission.
- Public Space installation/session/template contracts, rebuilt and synchronized into the desktop and app-package repositories.
- Beta installation reset migrations and new local storage/navigation namespaces.

## Remaining release blockers

1. **Legacy extensions are not migrated end to end.** Local package installation/enablement still exists. The frontend command adapter and workspace boundary now filter by Space availability, but native command admission, local-only provenance, version-specific legacy packages, hydration, and the legacy Store mutation path need the new authority model. Frontend filtering alone is not the required native enforcement.
2. **Third-party templates need release resolution.** Creation currently resolves the official catalog. Add verified SDK/legacy release resolution and package provenance to creation, permission review, and install transaction handling; exclude local-only packages explicitly. SDK apps also need complete member-facing navigation and package availability states.
3. **Finish account/device isolation.** Connected-account selection is implemented for the unified connected-account APIs. Audit cloud/calendar bridges, browser-profile reuse and explicit selection, provider account removal semantics across Spaces, and native grants. A selected connection does not itself grant any other member access.
4. **Finish the runtime/content audit.** Central gates and tested Journal paths are covered, but all direct content APIs, collaboration socket invalidation, retained activity/search caches, provider retrieval, durable routines, device jobs, and native execution require an end-to-end revocation audit. Verify already committed effects remain recorded and restore cannot resume canceled work.
5. **Complete template/creation edge cases.** Current release or template changes between a committed create and its retry need coverage. Complete dependency review and recovery UX, personal-template grouping and management behavior, and all unsupported-device states.
6. **Complete reset verification and database regression migration.** Prove preservation using a populated pre-reset fixture. Migrate remaining old user-installation test fixtures and run the full server authorization/database suites. The old database installation/purge helpers remain in the source and need removal once their remaining test callers are migrated; they must not become runtime fallback authority.
7. **Complete a two-account desktop walkthrough.** Exercise Family creation/join, removal with open apps, restoration, account isolation, two independent releases, and third-party execution on actual desktop surfaces before release.

## Verification completed

- Server postgres/httpapi unit suites and application package compilation passed.
- Ten focused database contract scenarios passed on the disposable migrated database: Space independence; member/delegated-manager behavior; private records; retained Journal data; session revocation; shared SDK provider use; publisher continuity; SDK provider ceilings/versioning; personal connection selection; template seeding/retry; and dependencies/shared ordering (several behaviors share one test).
- Public SDK checks, packed-consumer verification, and synchronization into both consumers passed.
- 489 frontend tests passed across apps, Space creation, onboarding, global search, and Home (81 test files). Touched frontend files pass ESLint, and all four repository diffs pass whitespace checks.
- Desktop production build and app-package build passed.
- Native `cargo check --lib` passed. Seven package-protocol tests passed.
- Full database regression suite, full native runtime suite, reset preservation walkthrough, and two-account desktop walkthrough have **not** been completed.

These checks validate the implemented portions; they do not satisfy the remaining release blockers above.
