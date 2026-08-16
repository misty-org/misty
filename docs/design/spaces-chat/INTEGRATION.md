# Production integration — October 1, 2026

The approved layout now lives in the application. `mockups/production.html` renders the production message row, composer, conversation switcher, All collection, and sidebar against isolated fixture adapters. Its mutations affect memory only. The original prototype remains available at `/`. The native `dev1` application was also inspected at its real `/spaces/.../social/misty` route; this confirmed the application layout and switcher interaction, while exposing the live development API rollout gap described below.

## Implemented behavior

- One compact chat header replaces the back-navigation row. The title opens a searchable shared Command/Popover, at every window width. Everyone, channels, direct messages, and connected chats retain their proper provider routes. New chat uses the existing creation dialog; Browse all returns to the chat collection. Empty conversation groups are suppressed. The popover is constrained to the available window width.
- Avatars and message bodies share a horizontal layout. Replies use an elbow connector in the avatar gutter. A single floating toolbar appears on hover or focus, including when a touch user taps the focusable message. Copy is available in read-only conversations; writing actions follow existing permissions and ownership rules.
- The composer grows from a compact row, with mention/emoji/send controls and the existing attachment picker where permitted. Enter sends, Shift+Enter adds a newline, and composing IME input does not submit. Edit uses Save/Cancel. Deletion confirmation stays open after a failed request. Retry reuses the original message nonce, attachments, and reply, without clearing a new draft. Empty chat invites the user to “Start the conversation” and directs them to the message field below. Error icons use the approved neutral palette.
- Unsent text, selected attachments and reply targets live in account-session-scoped memory per conversation. They survive switching and component remounting, but not app reload or an account-session change. Upload completion belongs to its original draft. The existing per-chat scroll restoration remains in use.
- Sidebar Recents remains present while Chat is open, lists five distinct opened content references, and expands with Show more. Tool landing pages are excluded. Titles and destinations resolve through authorized content reads, so removed or inaccessible items do not appear. Members and Usage are full-width ghost controls stacked below the divider.
- All opens on Yours, then Suggested and Favorites. Yours filters by creator/uploader. Suggested orders assigned overdue/due-today tasks, unread mentions, then unresolved explicit requests that target accessible content. It does not substitute recent activity. Favorites are personal cross-type stars, separate from Journal pins and Library's shared favorite field.

## Server rollout

Apply `server/internal/platform/postgres/migrations/20271002010000_space_personal_item_state.sql` with the normal migration workflow before serving this frontend. No deployment or live data migration was performed by this task. All migrations were successfully applied to a fresh, isolated test database, `codex_spaces_test_20261001`; that validation does not update the live development API.

The inspected live development API still lacks the new item-state endpoint. Consequently, Recents and Favorites show a load failure in the actual application until the API and migration are rolled out. The working fixture preview must not be treated as evidence that these account-backed features work against the current live service.

`GET /spaces/{spaceID}/item-state` reads the signed-in member's private reference index. `PATCH` accepts an item key and optional `favorite` or `opened` mutation. Membership checks and row-level security scope records to their account and Space. The index stores only canonical content keys and personal state, never copied content or grants of access. Mutation of a favorite preserves its visit time; opening an item preserves its favorite state. Retention keeps 100 recent references plus up to 2,000 favorites per Space.

Committed changes emit a content-free `space-personal-items` account event through the existing account stream. Clients refresh on that event, stream reset, and window focus. No polling is added.

Suggestions consume existing task fields and account Activity attention signals. Explicit request suggestions appear only when the source supplies an unresolved request and an accessible content target. The UI does not infer requests from ordinary messages or promise signals that sources do not supply.

## Validation record

- 74 frontend regression tests across 19 files pass. They cover message permissions, retry idempotency/payload preservation, late conversation completions, draft restoration and late uploads, scoped content reads, filters, navigation, suggestion ordering, and real application entry routing.
- Browser fixture checks cover desktop and narrow desktop windows, keyboard conversation search/selection, focus restoration, conversation search focus, edit, and All filters. Screenshots are in `.impeccable/review/spaces-chat-production/`, with current production captures copied to `mockups/screenshots/`.
- Actual application inspection in native `dev1` confirmed the compact composer, Space sidebar, and conversation switcher on the real chat route. Keyboard Escape returned focus to the title trigger. The saved [actual-app switcher capture](mockups/screenshots/app-desktop-switcher.jpg) records that inspection. This is distinct from the isolated production-component fixture and does not establish successful live personal-state loading.
- Application and preview TypeScript checks, targeted ESLint, and the desktop production build pass. The final desktop build and preview build retain existing chunk warnings, including settings circular-chunk and large-bundle warnings.
- The independent reviewer scored both material fixes resolved: stopping upload batches on an account-session change, and scoping delete confirmations to their originating session/Space/conversation. This is a bounded fix verdict, not a claim of complete application verification.
- Go package compilation and item-key validation pass. The metadata PostgreSQL contract test passes against the owned, isolated `codex_spaces_test_20261001` database after all migrations were applied. The earlier shared test database reset failed with `permission denied for table github_webhook_deliveries`; using the isolated database avoided that blocker without changing unrelated table ownership or permissions. The final contract rerun also passed the co-member state isolation assertion. The owned temporary database was removed after validation. The contract command is `go test ./test/contract/postgres -run TestSpacePersonalItems -count=1` from `server`, configured to use the isolated test database.

The design fixture is not evidence of live account delivery. The isolated migration and contract results establish test-database behavior only; no live service rollout has been performed. Connected-provider message capabilities continue to rely on the existing service permission checks.

## Shared composer and compact density follow-up

`MessageComposer` now provides the frame, growing textarea, leading/trailing actions, reply/attachment context, footer, and overlay slots for `SpaceChatComposer`, `MistyComposer` (Agents and Global Misty), and `AgentExecutionSurface`. `GlobalMistyChrome` uses that same frame. Feature adapters retain draft, upload, permission, mention, recording, and submission behavior. The shared `MessageComposerSend` uses ArrowUp; running agents retain Stop. Agents-only composer CSS overrides were removed. See the [usage contract](../../../src/shared/ui/patterns/MessageComposer.md).

The shared sidebar is 224px wide with 8px padding and a 14px heading. Space navigation and management labels use 13px text; section links are 32px tall with a 44px coarse-pointer minimum. Shared collection pages use 20px titles, 16px gaps, 16px/24px horizontal padding, 28px filter controls with 13px text, and 32px search fields.

This follow-up passed 54 targeted tests across nine files, TypeScript, targeted ESLint, and the desktop production build. Existing bundle warnings remain. Real application inspection covered Agents and Spaces. The production-component preview covered desktop at 1440px and the All collection at 720px without horizontal overflow. The desktop composer measured 52px at rest with 14px input text. These checks establish layout and the targeted regression coverage, not end-to-end message delivery.

Saved evidence: [desktop composer](mockups/screenshots/shared-composer-desktop.jpg), [Agents in the application](mockups/screenshots/shared-composer-agents-app.jpg), [Spaces in the application](mockups/screenshots/compact-spaces-app.jpg), and [narrow All collection](mockups/screenshots/compact-spaces-narrow.jpg).

The live Recents/Favorites API rollout gap described above remains unchanged; this follow-up did not deploy the API or run a live migration.
