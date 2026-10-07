# Spaces and Chat

The approved Spaces and Chat refinement is implemented in the application: compact conversation switching and composition, horizontal message rows, a connected reply elbow, one floating action toolbar, personal cross-type favorites and recents, and the Yours → Suggested → Favorites collection. This directory keeps the original approved prototype alongside a fixture preview that renders the production components.

Production code is implemented, but no deployment or live database migration was performed. See [INTEGRATION.md](INTEGRATION.md) for server rollout, permission boundaries, and validation limitations, and [DESIGN.md](DESIGN.md) for the scoped visual record.

## Run and review

From the repository root, with dependencies installed:

```sh
node node_modules/vite/bin/vite.js --config docs/design/spaces-chat/mockups/vite.config.mjs
```

| Preview | Link and scope |
| --- | --- |
| Production components | [Chat and Space navigation](http://127.0.0.1:5217/production.html). Open All in the sidebar to review Yours, Suggested, and Favorites. |
| Original approved prototype | [Chat](http://127.0.0.1:5217/), [Yours](http://127.0.0.1:5217/?view=all), [Suggested](http://127.0.0.1:5217/?view=all&filter=Suggested), [Favorites](http://127.0.0.1:5217/?view=all&filter=Favorites). Historical layout and interaction reference. |
| Original prototype states | [Empty](http://127.0.0.1:5217/?state=empty), [loading](http://127.0.0.1:5217/?state=loading), [read only](http://127.0.0.1:5217/?state=read-only), [failed send](http://127.0.0.1:5217/?state=failed). |
| Screenshot gallery | [Gallery](http://127.0.0.1:5217/gallery.html). Foregrounds the desktop production captures and labels earlier screenshots as historical design studies. |

Both previews are isolated from live accounts. `mockups/production.tsx` mounts the real message row, composer, conversation switcher, All collection, and sidebar inside a fixture wrapper; `productionData.ts` supplies adapters. Preview mutations affect memory only. The original prototype also keeps messages, drafts, attachments, favorites, recents, and new items in memory; reload or **Reset** restores its fixture.

## Implemented behavior

- **Sidebar:** All, Chat, Planner, Journal, and Library; Recents always follows the main navigation, including while Chat is open. Five distinct opened items appear before Show more. Members and Usage are separate full-width ghost controls stacked below the divider, without an enclosing box.
- **Chat:** avatars and message bodies align horizontally. Replies connect to the avatar gutter with an elbow and expose a jump to the original message. A single floating toolbar appears on hover or focus. Keyboard focus reveals the same toolbar. Inline edit, confirmed delete, reactions, Copy, and failed-send Retry follow existing permissions and ownership rules.
- **Switching and composition:** the header opens a searchable shared Command in a Popover at every window width. Everyone, channels, direct messages, and connected chats retain their provider routes. The compact composer grows with text and includes mentions, emoji, sending, and permitted attachments. Draft text, attachments, and reply targets survive conversation switching and remounting within the account session; reload or an account-session change clears them. Existing per-chat scroll restoration remains in use.
- **All:** Yours shows items created or uploaded by the signed-in user; Suggested uses real task and Activity attention signals; Favorites collects personal stars across supported chats, tasks, notes, drawings, and files. Filters stay in that order. There is no Recent filter or shortcut block. Search, sorting where applicable, and list/grid views use shared collection controls.
- **Personal state:** a server-backed account-and-Space index stores personal favorites and opened-item references. Authorized content reads supply current titles and destinations. Favorites are separate from Journal pins and Library's shared favorite field. Explicit request suggestions require a supplied unresolved request and an accessible content target; ordinary messages are not inferred to be requests.

Connected-provider capabilities continue to use the application's service permission checks. Fixture dialogs and in-memory callbacks do not demonstrate live delivery, uploads, or provider authorization.

## Current screenshots

Production component captures cover desktop (1440 × 900) and narrow (720 × 900) windows:

| Surface | Captures |
| --- | --- |
| Chat | [Desktop](mockups/screenshots/production-desktop.jpg), [narrow](mockups/screenshots/production-narrow.jpg) |
| Conversation picker | [Popover](mockups/screenshots/production-switcher.jpg) |
| Message edit | [Inline editing](mockups/screenshots/production-edit.jpg) |
| All | [Yours](mockups/screenshots/production-all-yours.jpg), [Suggested](mockups/screenshots/production-all-suggested.jpg), [Favorites](mockups/screenshots/production-all-favorites.jpg) |

Screenshots without the `production-` prefix preserve the earlier prototype and its prior dimensions and states; they do not override the final message layout or touch interaction.

## Validation and rollout

Application and preview TypeScript, targeted lint, and desktop build checks passed. The final frontend regression suite passed (64/64 across 17 files). Frontend tests cover message permissions, retry payload preservation, conversation changes during pending work, draft restoration and late uploads, scoped content reads, filters, navigation, and suggestion ordering. Browser fixture checks covered desktop and narrow window sizes, keyboard search and selection, focus restoration, conversation search focus, editing, and All filters.

The independent review's final **SHIP** disposition was bounded to two repairs: upload session isolation and deletion-target scope. Both were resolved, and their targeted regression suite passed (4/4). This was not a new whole-surface audit or a full automated accessibility certification.

Go package compilation and item-key validation passed. The PostgreSQL contract test stopped before assertions because the existing test database reset reported `permission denied for table github_webhook_deliveries`. Database contract behavior remains unverified in that environment. Apply `server/internal/platform/postgres/migrations/20271002010000_space_personal_item_state.sql` through the normal migration workflow before serving the frontend, and rerun the contract test after repairing the test environment. Full details and the command are in [INTEGRATION.md](INTEGRATION.md).

The original prototype's earlier browser review and bounded six-repair SHIP verdict remain historical evidence only. Its detector ran with missing parsers and an Inter overuse warning; incumbent typography was intentionally retained.

## Source map

- `src/features/spaces/`: production chat, sidebar, collections, personal-item reads, and suggestion signals.
- `src/features/chat-composer/useSpaceChatDraft.ts`: account-session-scoped per-conversation draft state.
- `server/internal/platform/{postgres,httpapi}/space_personal_item_state.go`: personal metadata storage and API.
- `mockups/production.tsx` and `productionData.ts`: isolated production component fixture.
- `mockups/App.tsx`, `Chat.tsx`, `Collection.tsx`, `controls.tsx`, `model.ts`, and `preview.css`: original approved prototype.

Shared UI and semantic tokens remain the visual authority. This refinement does not change settings navigation or the server-account settings model.
