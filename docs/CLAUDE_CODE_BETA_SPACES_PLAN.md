# Misty Beta Spaces Reliability Plan

This document is the implementation contract for Claude Code. It covers the
desktop app in `/Users/mtccool668/misty-org/misty`, the Go API in
`/Users/mtccool668/misty-org/misty-server`, and a new Cloudflare-hosted note
collaboration service.

Do not redesign unrelated UI, reformat unrelated files, or overwrite the
existing dirty worktrees. Implement this plan in the order given, keeping every
phase independently testable.

## Product decisions that must not change

- The Agents page contains only: `Agents are coming soon...`
- A new note is private to its creator.
- The creator has read, write, delete, and permission-management access.
- Only the creator can change note permissions. A Space owner has no override.
- The creator can grant `viewer` or `editor` access only to current members of
  the note's Space.
- Notes use live CRDT collaboration, hosted in Misty's Cloudflare account with
  PartyKit and Durable Objects.
- Notes are online-only during beta. Do not add offline document persistence.
- Existing local-only notes and local note assets are deleted, not migrated.
- When a creator leaves or is removed from a Space, their notes are archived
  for 30 days. Rejoining within that period restores them.
- Deleting the creator's account immediately and permanently deletes all notes
  they created.
- Active task conflicts use server-receipt last-write-wins.
- Archived tasks are tombstones and cannot be resurrected by stale writes.
- Upload limits are:
  - Space Library: 100 MB per file
  - Note attachment: 15 MB per file
  - Chat attachment: 10 MB per file
- User file uploads and downloads go directly between the client and
  Cloudflare R2. The VPS remains the authorization and metadata control plane.

## Current implementation to preserve

- Notes currently use the local connector in
  `src/features/notes/connectors/mistyNativeNotes.ts` and account-scoped
  `localStorage`.
- The note editor already uses BlockNote 0.52.1. BlockNote brings Yjs
  transitively, but no collaboration provider is installed.
- The task UI fetches on entry/filter changes and refetches after
  `misty:space-coordination-event`. It does not have a recurring polling timer.
- `useSpacesStore.ts` already maintains the authenticated `/realtime`
  WebSocket, reconnects with a replay cursor, and dispatches Space events.
- The Go realtime service already uses PostgreSQL LISTEN/NOTIFY, durable
  `space_events`, replay, ping/pong, presence, and authenticated tickets.
- The Library already has upload reservations, quota accounting, immutable
  object records, message attachments, attachment promotion, scanning,
  deduplication, and cleanup.
- The desktop Library uploader already accepts either a relative proxy URL or an
  absolute direct-transfer URL.
- Production upload initiation currently returns the proxied
  `/library/uploads/{uploadID}/content` URL. Downloads are also proxied.
- The Go server currently configures a single 250 MB Library service limit.
  Replace it with explicit limits by upload purpose.

## Target architecture

```text
Desktop app
  ├─ REST metadata, ACL, tickets ───────────────> Go API ──> PostgreSQL
  ├─ Space metadata events ────────────────────> Existing Go WebSocket
  ├─ BlockNote/Yjs room ───────────────────────> PartyKit Worker
  │                                                └─ Durable Object per note
  └─ Signed PUT/GET ───────────────────────────> Cloudflare R2

Go API
  ├─ Authorizes every note, upload, and download request
  ├─ Signs short-lived note collaboration tickets
  ├─ Issues signed R2 operations after permission/quota checks
  ├─ Receives revisioned note search/list projections
  └─ Sends authenticated room ACL/disconnect/purge commands to PartyKit
```

PostgreSQL is authoritative for note identity, metadata projections,
permissions, lifecycle, membership, quota, and audit history. The Durable
Object is authoritative for the Yjs collaborative document.

## Phase 1: Simplify Agents safely

1. Replace the desktop Agents page body with one centered text element:
   `Agents are coming soon...`
2. Preserve the Agents route and navigation item.
3. Do not initialize agent stores, request `/agents`, request `/ai/models`, open
   agent sessions, or render configuration dialogs from this route.
4. Leave existing agent implementation files in place unless removing an import
   is required. This is a beta UI gate, not deletion of the feature.
5. Add a component test that renders the route, checks the exact copy, and
   confirms no agent/model backend request occurs.

## Phase 2: Direct R2 transfer and purpose-specific limits

Implement direct transfer before collaborative note attachments so Library,
chat, and notes share one secure upload foundation.

### 2.1 Server configuration

Replace the single Library maximum with purpose-specific configuration:

```text
MISTY_LIBRARY_MAX_FILE_BYTES=104857600
MISTY_CHAT_ATTACHMENT_MAX_FILE_BYTES=10485760
MISTY_NOTE_ATTACHMENT_MAX_FILE_BYTES=15728640
MISTY_R2_DIRECT_TRANSFERS=true
MISTY_R2_UPLOAD_URL_TTL=15m
MISTY_R2_DOWNLOAD_URL_TTL=2m
```

Production startup must fail if direct transfers are enabled but the configured
object store cannot sign R2/S3 operations. Local development may continue using
the existing local object store and relative proxy transfer route.

### 2.2 Object-store interface

Extend the object-store abstraction with:

- Presigned PUT generation for one exact object key, expected content type,
  declared byte length, and required object metadata.
- Presigned GET generation for one exact object key and safe
  `Content-Disposition`.
- HEAD/stat support used during finalization.
- Delete support for abandoned or purged data.

Use the AWS SDK v2 S3 presigner against the existing private R2 bucket. Never
return R2 credentials to the client. Object keys remain opaque server-generated
keys under the existing permanent Library prefix.

### 2.3 Upload initiation and finalization

Extend the existing upload purpose contract to:

```go
type UploadPurpose string

const (
    UploadPurposeLibrary        UploadPurpose = "library"
    UploadPurposeChatAttachment UploadPurpose = "attachment"
    UploadPurposeNoteAttachment UploadPurpose = "note_attachment"
)
```

Enforce the purpose-specific maximum in both the API service and database layer.
Do not rely on the desktop check.

Upload initiation must:

1. Authenticate the user.
2. Verify the purpose-specific Space or note permission.
3. Validate filename, MIME declaration, size, and SHA-256 shape.
4. Reserve quota using the existing owner/Space quota transaction.
5. Generate an opaque R2 object key and short-lived upload token.
6. Return an absolute presigned PUT URL in the existing `transfer` response.
7. Include only the headers covered by the signature.

The existing desktop `transferLibraryObject` path should upload an absolute URL
without cookies or Misty authorization. Preserve progress and cancellation.

Finalization must:

1. Authenticate the user and validate the Misty upload token.
2. HEAD the exact R2 object.
3. Reject missing objects, size mismatches, expired reservations, and metadata
   mismatches.
4. Move the upload into the existing verification/quarantine pipeline.
5. Commit quota and create the Library item, chat attachment, or note asset only
   after verification succeeds.
6. Delete the object and release quota on terminal failure.
7. Be idempotent when the client retries after a timeout.

Do not synchronously proxy the user's upload through the VPS. If malware or
content verification requires reading an R2 object, perform it as bounded
background work with strict concurrency and byte limits.

### 2.4 Direct downloads

Change authorized download handlers to return a short-lived signed GET
descriptor instead of streaming object bytes through Go:

```json
{
  "url": "https://signed-r2-url",
  "expires_at": "RFC3339 timestamp",
  "filename": "safe filename"
}
```

The desktop then downloads the absolute URL without Misty cookies. Authorization
is checked before every URL is issued:

- Library download requires `library.view`.
- Chat attachment download requires access to its message/conversation.
- Note attachment download requires creator, viewer, or editor access to its
  parent note.

Previews or transformations may remain server-generated, but final object
delivery should use signed R2 access.

### 2.5 R2 CORS

Configure the bucket for `PUT`, `GET`, and `HEAD` from only the explicit Misty
development origins and packaged Tauri origins used on macOS and Windows.
Allow only required signed headers. Do not use wildcard origins with
credentials.

### 2.6 Chat attachment behavior

- Enforce 10 MB per file in the desktop picker and server.
- Reuse existing `attachments.upload` and message-write permission checks.
- Keep pending attachments scoped to uploader and Space until attached to a
  message.
- Message creation atomically claims pending attachment IDs.
- Message deletion schedules unpromoted attachments for object cleanup.
- Existing promotion into the Library remains supported and must not duplicate
  physical storage or quota.
- Expired or abandoned pending attachments are purged by the cleanup worker.

## Phase 3: Server-backed note data model

Add a new Goose migration. Use text IDs with existing project prefixes and UUID
generation conventions.

### 3.1 `space_notes`

Required fields:

```text
id                       primary key, prefix note_
space_id                 references spaces
creator_user_id          references users
title_projection         non-null text
plain_text_projection    non-null text
shared_tags              JSONB array, default []
lifecycle_state          active | archived_creator_left | deleting
archived_at              nullable timestamptz
purge_after              nullable timestamptz
collaboration_revision   bigint, default 0
acl_version              bigint, default 1
created_at
updated_at
```

Indexes:

- `(space_id, lifecycle_state, updated_at desc)`
- `(creator_user_id, lifecycle_state)`
- `(purge_after)` for cleanup
- Search index appropriate for title/plain-text/tag lookup

### 3.2 `space_note_permissions`

Required fields:

```text
note_id          references space_notes on delete cascade
user_id          references users on delete cascade
role             viewer | editor
granted_by       references users
created_at
updated_at
primary key      (note_id, user_id)
```

Constraints:

- The creator must never have a permission row; creator access is implicit.
- `granted_by` must be the creator.
- A grant is valid only while the recipient is a current member of the same
  Space.

### 3.3 `space_note_preferences`

Store user-specific UI state separately:

```text
note_id
user_id
is_favorite boolean default false
created_at
updated_at
primary key (note_id, user_id)
```

Favorites do not affect access and are removed when the user loses note access.

### 3.4 `space_note_assets`

Link a verified `note_attachment` upload/file to its parent note:

```text
id
note_id
file_id
uploader_user_id
display_name
lifecycle_state
created_at
deleted_at
```

Assets inherit access exclusively from the parent note. Editors may upload
assets; viewers may only download them. Only the creator can permanently remove
an asset referenced by the document; editors may remove a reference from the
document without bypassing retention cleanup.

### 3.5 Access helpers

Create one canonical database access function used by every note handler:

```go
type NoteAccess struct {
    CanView        bool
    CanEdit        bool
    CanManageACL   bool
    CanDelete      bool
    Role           string
}
```

Rules:

- Creator: all capabilities.
- Current Space member with `editor`: view and edit.
- Current Space member with `viewer`: view only.
- Space owner/admin without a note grant: no capabilities.
- Former Space member: no capabilities even if a stale permission row exists.
- Archived note: no normal user access until restored.

Unauthorized list/get/download calls must behave as not found. Do not reveal the
note title, creator, timestamps, asset names, or whether the note exists.

Apply PostgreSQL RLS consistent with the server's existing Space request context,
but retain explicit application checks. Add RLS tests covering the Space-owner
non-override rule.

## Phase 4: Note REST API and realtime metadata

Mount these routes under the existing `/api` prefix:

```text
GET    /spaces/{spaceID}/notes
POST   /spaces/{spaceID}/notes
GET    /spaces/{spaceID}/notes/{noteID}
PATCH  /spaces/{spaceID}/notes/{noteID}/metadata
DELETE /spaces/{spaceID}/notes/{noteID}

GET    /spaces/{spaceID}/notes/{noteID}/permissions
PUT    /spaces/{spaceID}/notes/{noteID}/permissions

POST   /spaces/{spaceID}/notes/{noteID}/collaboration-ticket

POST   /spaces/{spaceID}/notes/{noteID}/assets/uploads
POST   /spaces/{spaceID}/notes/{noteID}/assets/uploads/{uploadID}/finalize
GET    /spaces/{spaceID}/notes/{noteID}/assets/{assetID}/download
DELETE /spaces/{spaceID}/notes/{noteID}/assets/{assetID}
```

### API behavior

- List returns only active notes the caller can view.
- Create assigns the authenticated caller as creator and creates no permission
  grants.
- Metadata PATCH is for server-owned non-CRDT metadata such as shared tags.
  Collaborative title/body changes arrive through PartyKit projections.
- Permissions PUT accepts the complete desired grant set, locks the note,
  validates every recipient, replaces grants atomically, and increments
  `acl_version` only when the effective ACL changes.
- Only the creator may list or modify the full permission set.
- Non-creators receive only their own effective role in the normal note
  response.
- Delete is creator-only and begins idempotent asynchronous hard deletion.

### Space event privacy

Add metadata event types:

```text
note.created
note.projection.updated
note.permissions.changed
note.archived
note.restored
note.deleted
```

Do not broadcast these to every Space member. Extend realtime delivery/replay so
a `note.*` event is visible only to:

- the creator; and
- current members with an active permission row at delivery time.

When a new grant is added, send a targeted notification to the recipient. When
a grant is revoked, send a targeted removal signal and close the PartyKit
session. Event payloads contain IDs and safe metadata only, never Yjs updates or
full note content.

## Phase 5: Cloudflare PartyKit/Yjs service

Create the Cloudflare project under
`/Users/mtccool668/misty-org/misty-server/cloudflare/journal-collab`.

Use current PartyKit/Y-PartyKit packages compatible with Cloudflare Durable
Objects and the desktop's installed BlockNote/Yjs versions. Pin exact versions
in the lockfile.

### 5.1 Environment and secrets

Required configuration:

```text
PARTYKIT_HOST
JOURNAL_COLLAB_TICKET_PRIVATE_KEY    Go server only
JOURNAL_COLLAB_TICKET_PUBLIC_KEY     Cloudflare only
JOURNAL_COLLAB_CONTROL_SECRET        Go and Cloudflare
JOURNAL_COLLAB_PROJECTION_SECRET     Go and Cloudflare
MISTY_INTERNAL_API_BASE              Cloudflare only
MISTY_JOURNAL_COLLAB_ENABLED
```

Use Ed25519-signed collaboration tickets. Do not share the signing private key
with Cloudflare. Use distinct service secrets for Go-to-Cloudflare control calls
and Cloudflare-to-Go projection calls.

### 5.2 Ticket claims

Tickets expire after 60 seconds and are scoped to one connection:

```json
{
  "iss": "misty-api",
  "aud": "misty-journal-collab",
  "jti": "single-use identifier",
  "sub": "user id",
  "space_id": "space id",
  "note_id": "note id",
  "room": "opaque room id",
  "role": "creator | editor | viewer",
  "acl_version": 1,
  "exp": 0
}
```

The Go ticket endpoint rechecks access immediately before signing. PartyKit
verifies issuer, audience, signature, expiration, room equality, and single-use
`jti`.

### 5.3 Room behavior

- One Durable Object room represents exactly one note.
- Persist Yjs state in Durable Object storage after updates using a short
  debounce.
- Viewers receive state and awareness but cannot submit document updates.
- Creators and editors may submit updates.
- Awareness/presence is ephemeral and must not be written to PostgreSQL.
- Apply message-size, connection-count, and update-rate limits.
- Dispose idle rooms without deleting their persisted document.
- Reject a ticket whose ACL version is older than the room's known ACL version.

### 5.4 Permission revocation

After an ACL transaction commits, Go sends the room its new ACL version and the
affected user roles. PartyKit:

1. Updates the room ACL version.
2. Disconnects revoked users.
3. Disconnects downgraded editors so they must reconnect as viewers.
4. Rejects document updates from sockets carrying an older ACL version.

Record failed control delivery in a retryable database outbox. Active rooms also
refresh their ACL version from an authenticated Go endpoint at least every 15
seconds, providing a bounded fallback if the immediate control request fails.
Fail closed for document writes when the authorization lease expires.

### 5.5 Projection contract

Keep the collaborative title and a plain-text body projection in named Yjs
types updated in the same client transaction as document edits. PartyKit sends a
debounced projection no more than once per second:

```json
{
  "note_id": "note id",
  "room": "opaque room id",
  "revision": 42,
  "title": "current title",
  "plain_text": "bounded searchable text",
  "updated_by": "user id"
}
```

Sign the timestamp and raw request body with the projection service secret. The
Go endpoint verifies the signature and rejects replayed timestamps, wrong room
IDs, unauthorized `updated_by` users, oversized projections, and revisions less
than or equal to the stored revision.

Limit the stored/searchable plain-text projection to a documented maximum
length. The full document remains in Yjs, not PostgreSQL.

### 5.6 Purge contract

Expose an authenticated, idempotent room purge command. It must:

- disconnect all clients;
- delete Durable Object Yjs state;
- delete used ticket identifiers and room metadata; and
- return success when the room was already absent.

## Phase 6: Desktop Notes integration

### 6.1 Dependencies

Add direct dependencies for the exact Yjs and PartyKit provider packages used by
BlockNote. Do not depend accidentally on BlockNote's transitive Yjs version if
the provider needs it as a peer dependency.

Do not install `y-indexeddb` or any offline persistence provider.

### 6.2 Replace the local connector

Replace the local-only native connector with a server connector that:

- lists accessible notes from the Go API;
- creates private notes;
- updates shared tags;
- archives/deletes creator-owned notes;
- loads and replaces creator-managed ACLs;
- requests collaboration tickets; and
- initiates/finalizes note asset uploads.

The store must be account-generation aware, discard stale responses after an
account switch, and close every active PartyKit connection when the user signs
out or switches accounts.

### 6.3 Collaborative editor lifecycle

When opening a note:

1. Fetch accessible note metadata.
2. Request a collaboration ticket.
3. Create a fresh in-memory `Y.Doc`.
4. Connect the PartyKit provider to the ticket's exact room.
5. Create BlockNote with its collaboration configuration.
6. Render read-only mode for viewers and editable mode for creator/editor.
7. Show connecting, reconnecting, permission-lost, and unavailable states.

When closing or switching notes:

- destroy the BlockNote editor;
- destroy the provider;
- destroy the in-memory Y.Doc; and
- clear awareness state.

Do not serialize the complete document into localStorage and do not require a
manual Save button for collaborative body changes. Retain explicit controls only
for non-CRDT metadata where needed.

### 6.4 Permissions UI

Use the existing note context panel:

- Creator sees current Space members with `None`, `View`, and `Edit`.
- Save sends the complete intended grant set.
- The creator cannot remove their own implicit access.
- Current recipient access and pending state are clear.
- Viewer/editor sees only their own role; no member ACL is exposed.
- Space owner without access cannot see the note or permissions UI.

On revocation, immediately remove the note from the local list, close its room,
and return to the Notes empty/list state without exposing cached content.

### 6.5 Note assets

- Enforce the 15 MB client-side convenience check and server-side hard limit.
- Upload directly through the shared R2 transfer mechanism.
- Insert stable asset references into BlockNote, never local filesystem paths.
- Resolve display/download URLs through authorized short-lived descriptors.
- Other authorized collaborators must be able to render the same assets.
- Do not keep the current Tauri-only local note asset copies.

### 6.6 Legacy local data removal

Add a one-time client migration marker. On the first launch of the server-backed
Notes version:

1. Remove only the legacy Misty note localStorage keys.
2. Ask the existing Tauri note-assets command to remove the legacy note asset
   directory using an explicit validated path.
3. Set the migration marker only after both operations complete or the asset
   directory is confirmed absent.
4. Never touch unrelated local files.

No import prompt and no server migration are required.

## Phase 7: Note lifecycle and retention

### Creator leaves or is removed from a Space

In the same membership-removal transaction:

- set the creator's active notes to `archived_creator_left`;
- set `archived_at=NOW()` and `purge_after=NOW()+30 days`;
- increment `acl_version`;
- emit ACL-safe archive events; and
- enqueue room disconnect commands.

Archived notes are inaccessible to everyone, including prior viewers/editors.

### Creator rejoins

If the same user rejoins the same Space before `purge_after`:

- restore their `archived_creator_left` notes to active;
- clear archival timestamps;
- preserve the prior permission rows, but only grants to users who are still
  current Space members;
- increment `acl_version`; and
- emit authorized restore events.

### Other member leaves

Delete that member's note permission rows and preferences, increment affected
ACL versions, emit targeted removals, and disconnect their rooms.

### Account deletion

Before deleting/anonymizing the account:

- mark all creator-owned notes as deleting;
- synchronously revoke room access;
- enqueue immediate deletion of R2 note assets and Durable Object rooms; and
- delete note records after cleanup reaches an idempotent terminal state.

Do not transfer notes to a Space owner.

### Cleanup worker

Extend the existing retention worker with bounded batches for:

- notes whose 30-day archive period expired;
- abandoned note asset uploads;
- unreferenced note assets after the safety window;
- failed PartyKit control/purge outbox entries; and
- deletion jobs interrupted by server restart.

Every operation must be safe to retry.

## Phase 8: Task last-write-wins

Keep the existing realtime architecture. Do not add task polling.

### Active writes

- Continue accepting the existing client `version` field for compatibility.
- Stop returning a conflict only because an active task's submitted version is
  stale.
- Lock the task row in the mutation transaction.
- If active, apply the submitted patch and increment the server version.
- Database row-lock acquisition order is the authoritative server receipt order.
- Return and emit the complete canonical task.

### Moves

- Preserve the existing ordering/advisory-lock behavior.
- Lock the moving task, verify it is active, calculate the final ordering, apply
  the move, and increment its version.
- A later server-received move wins.

### Archive tombstones

- Archive sets `archived_at` and increments the version.
- Update and move statements must require `archived_at IS NULL`.
- Stale updates against an archived task return the canonical archived/not-found
  result and never clear `archived_at`.
- Realtime replay must not resurrect an archived task on the client.

### Desktop behavior

- Keep optimistic UI if currently used, but reconcile with every mutation
  response and `task.*` realtime event.
- The current event-triggered refetch is acceptable for beta.
- Ensure the event handler removes archived tasks and does not merge an older
  task version over a newer one.

## Phase 9: Server and proxy hardening

### HTTP process

Replace bare `http.ListenAndServe` with an explicit `http.Server` configured
with:

- read-header timeout;
- bounded read/write/idle timeouts appropriate for JSON and signed-URL APIs;
- maximum header size;
- signal-aware graceful shutdown; and
- worker cancellation before database/realtime shutdown.

Do not apply a short write timeout to WebSocket connections.

### Request limits

- Apply small explicit maximum bodies to JSON endpoints.
- The upload proxy fallback must have a purpose-specific maximum and exist only
  for the local object store.
- Add rate-limit policies for note mutations, ACL changes, collaboration
  tickets, upload initiation/finalization, signed downloads, and internal
  callbacks.
- Keep request IDs and structured audit fields for user, Space, note, upload,
  and room IDs. Never log tickets, signed URLs, secrets, or note content.

### Reverse proxy

Document and verify:

- WebSocket `Upgrade`/`Connection` forwarding;
- sufficient WebSocket idle/read timeout;
- API origin preservation;
- a bounded JSON request-body limit;
- no need for large production upload bodies after direct R2 transfer; and
- explicit Cloudflare/R2 CORS origins.

### Health and readiness

Preserve the existing database, object-store, and realtime checks. Add:

- R2 presigner/configuration readiness when direct transfer is required;
- PartyKit host/signing/control configuration readiness when Journal collaboration is enabled;
- a shallow collaboration-service health check with a strict timeout; and
- cleanup/outbox backlog metrics without making readiness fail for a small
  transient backlog.

### Feature gating

`MISTY_JOURNAL_COLLAB_ENABLED` is off unless all required Go and PartyKit
configuration is valid. When disabled, the desktop shows a clear unavailable
state and must not fall back to insecure local-only notes.

## Phase 10: Verification and release gates

### Go database and API tests

Cover:

- new note visible only to creator;
- Space owner denied without a grant;
- viewer read-only and editor write access;
- creator-only permission listing/mutation/deletion;
- grant target must be a current Space member;
- unauthorized note returns indistinguishable not-found behavior;
- permission replacement and ACL version increments;
- ACL-filtered realtime delivery and replay;
- creator leave/archive, rejoin/restore, expiry/purge, and account deletion;
- note asset authorization and all three upload size limits;
- direct transfer initiation and idempotent finalization;
- expired URL/token/reservation and mismatched HEAD metadata;
- abandoned upload cleanup;
- simultaneous active task writes produce last-received state;
- stale task writes cannot resurrect an archive; and
- migration/RLS/permission grants for the runtime `misty_app` role.

### PartyKit tests

Cover:

- valid creator/editor/viewer ticket connection;
- invalid signature, wrong room, expired ticket, and reused `jti`;
- viewer update rejected;
- two editors' concurrent Yjs updates converge;
- persisted room restores after object eviction/restart;
- ACL increment disconnects revoked/downgraded users;
- stale socket cannot continue writing;
- projection debounce, signature, monotonic revision, and retry;
- room purge is idempotent; and
- message/update/connection limits.

### Desktop tests

Cover:

- Agents route exact copy and zero agent API traffic;
- Notes list only renders server-authorized notes;
- creator/viewer/editor UI modes;
- collaboration connection lifecycle and cleanup;
- account switching cannot leak the prior account's note state;
- permission revocation removes open content;
- no document body is written to localStorage;
- one-time deletion targets only legacy note keys/assets;
- Library 100 MB, note 15 MB, and chat 10 MB client validation;
- absolute R2 transfer omits Misty credentials and preserves progress; and
- task realtime merges and tombstone handling.

### End-to-end smoke tests

Run with two real test accounts and one shared Space:

1. Creator makes a note; second account cannot see it.
2. Creator grants View; second account can read but cannot type.
3. Creator upgrades to Edit; simultaneous edits converge.
4. Creator revokes access while the second account is typing; the second client
   disconnects and loses the note from its list.
5. Space owner repeats the access attempt without a grant and remains denied.
6. Upload and download a 100 MB Library test file directly through R2.
7. Reject a chat attachment over 10 MB and a note asset over 15 MB.
8. Exchange chat messages and verify updates arrive without manual refresh.
9. Submit simultaneous task edits and verify the last server-received active
   write wins.
10. Archive a task while another client submits a stale update; verify it stays
    archived.
11. Remove the note creator from the Space, verify immediate archive, rejoin and
    restore, then exercise permanent cleanup in a shortened test retention
    window.

### Required commands

Desktop:

```bash
npm run typecheck
npm test
npm run build:desktop
```

Go server:

```bash
./scripts/goose.sh up
go test ./...
```

PartyKit:

```bash
npm test
npm run typecheck
npm run build
```

Run migrations with the admin database credentials. Verify afterward that the
runtime `misty_app` role can use every required new table, sequence, function,
and RLS policy without owning the schema or migration table.

## Deployment order

1. Configure the R2 bucket CORS and lifecycle rules.
2. Deploy direct-transfer-capable Go server with the feature disabled.
3. Verify signed PUT/GET using a staging account.
4. Enable direct R2 transfers and verify Library/chat uploads.
5. Apply note migrations.
6. Deploy PartyKit/Durable Objects and configure secrets.
7. Deploy Go note APIs with Notes collaboration disabled.
8. Run API, ACL, RLS, and PartyKit staging tests.
9. Deploy the desktop build with server Notes connector.
10. Enable Notes collaboration for internal accounts, then beta accounts.
11. Monitor failures, outbox backlog, room connections, R2 operations, API
    latency, and task realtime reconnects.

Rollback must disable Notes collaboration without restoring local-only Notes.
Direct R2 transfer may fall back to the existing proxy only in controlled local
development; production rollback should disable new uploads rather than route
large file bodies through the VPS unexpectedly.

## Definition of done

- Agents exposes no unfinished AI configuration surface.
- Notes have no local-only source of truth.
- A note creator is the only permission administrator, including against Space
  owners.
- Authorized collaborators converge on one live BlockNote document.
- Revoked users cannot keep reading or writing through an existing session.
- Note lifecycle and cleanup survive retries and restarts.
- Tasks update live without polling and use explicit last-write-wins semantics.
- Archived tasks cannot be resurrected.
- Library, note, and chat files enforce 100 MB, 15 MB, and 10 MB respectively.
- Production file bodies do not pass through the VPS during normal user upload
  or download.
- macOS and Windows packaged builds pass direct-transfer CORS and realtime smoke
  tests.
- All database migrations, Go tests, PartyKit tests, desktop tests, type checks,
  and builds pass.
