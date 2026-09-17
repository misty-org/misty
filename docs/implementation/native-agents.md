# Native Misty Agents implementation

Misty owns personal agent profiles, conversations and local execution. Space app assignments are explicit and start empty. The existing Agents mini-app route opens the native roster without checking for an installed package.

## Boundaries

- `agent_id`, `task_id`, execution mode and owning window travel with an invocation. The server checks ownership, Space membership, installed app assignments and live execution authority independently of model tool selection.
- User mode can read assigned context and manage explicit profile/memory requests. Profile configuration tools are unavailable during Agent/Team execution. Native app writes and browser writes require explicit Agent/Team activation.
- Server leases expire after 25 seconds; native leases after 30 seconds. Renewal cannot resurrect a released task. Resuming creates a new task ID. Queued device work rechecks both assignment and lease; native browser dispatch checks the scope's task, agent and owning window.
- Team windows share the application process and original browser profile identities. Their navigation, webviews, tasks and context menus are window-specific. One main host dispatcher processes bounded concurrent device jobs. A window's pause/cancel only releases that task's authority.
- Closing a worker revokes native authority. Expired server authority appears paused in activity, never completed. Stop does not undo earlier writes. Resumed requests receive recent conversation history and bounded prior write receipts so uncertain effects can be inspected before repetition.
- Durable memory is private to user and agent, and optionally scoped to one Space. Per-turn instructions remain in conversation context. Profiles and assignments save atomically with optimistic profile version checks.

## Files and browser work

Apps publish configured destinations through `misty.browser.setDestinations`. The host stores them under deployment/account/Space/app keys and reuses existing provider account profile IDs. A fallback reads older stored integration accounts until registration occurs.

Native browser tools retain fresh-document semantic inspection and interaction. Visual capture uses WKWebView snapshots or WebView2 CapturePreview; normalized pointing consumes the inspected document. File uploads resolve conversation attachment IDs in the host, verify size and hash, and supply bytes only to the inspected file input. Selection is distinguished from the site's completed upload.

Images, PDF, text, Markdown, CSV, JSON and Word attachments have bounded model renditions. Local download receipts retain account, agent, Space and task association; completed native downloads are exposed through Task files. Native completion checks that the resulting file exists.

## Migration and package delivery

Apply `misty-server/internal/platform/postgres/migrations/20270207000000_native_personal_agents.sql` using the normal migration mechanism. It extends surviving Misty identities, assigns surviving history and memory to default Misty, and preserves attachments and run records. It does not recover previously deleted agents. Rollback requires a forward migration so private agent history is not silently deleted.

Build `misty-sdk`, run the host's `npm run sdk:sync -- ../misty-sdk`, then run server `npm run contracts:sync`. Keep generated contracts, package archives, consumers and lockfiles together. The legacy mini-app source and transport remain for older clients; the new desktop package build excludes Agents.

## Validation record

Automated tests cover SDK contracts, native browser boundaries, profile/assignment transactions, conversation ownership, memory isolation, lease exclusion/revocation, cancellation during startup, stale task callbacks and native routing. The isolated React profile review uses synthetic data; it is not evidence of live backend or native browser execution.

Release acceptance still requires real native conversations against Planner, Notion and Instagram; two simultaneously active Team windows; login, sleep, close and restart recovery; and Windows WebView2 uploads, captures, downloads and account reuse. Do not infer these passes from compilation or mocked UI tests.
