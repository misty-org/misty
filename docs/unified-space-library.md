# Unified Space Library

The Unified Space Library is an additive, feature-gated replacement for legacy
Space nodes. Existing `space_nodes` data remains available for rollback but is
not migrated into the new Library.

## Implemented foundation

- Personal and Space-owned security domains
- Immutable blobs, canonical files, and Space-scoped Library items
- One owner-pooled storage allowance across all owned Spaces (2 GB Free or 50 GB Pro), with atomic upload reservations
- A separate 1 GB per-file technical safeguard that is not a pricing entitlement
- Three owned Spaces total, including the owner-named personal Space
- Private permanent R2/S3 storage contract and persistent local development store
- Quarantine, server-side checksum/type verification, dangerous-format policy,
  EICAR detection, and optional isolated ClamAV streaming scans
- Same-domain physical deduplication with contributor-attributed logical records
- Centralized Space permission evaluation and member permission overrides
- Message attachments, attachment promotion, immutable Library references, and replies
- Albums, bounded Groups, Space-scoped People & Pets processing and manual correction
- Copy-on-write edit versions with quota-reserved JPEG/MP4 renditions, original
  recovery, current-version downloads, and two-phase rendition garbage collection
- Revocable direct Space grants, destination-domain imports, ZIP exports,
  Memories/Trips discovery, and duplicate merging
- Authenticated downloads and safe image previews
- Trash/recovery accounting, shared-pool reservation expiry, audit records, and quota reconciliation

## Capability configuration

The Space Library, uploads, attachments, Groups, locations, duplicates,
imports, and exports are enabled by default. AI metadata activates when the AI
Gateway key is configured. Previews and editing activate when
`ffmpeg` and `ffprobe` are installed on the server PATH. People processing activates when
`VISION_PROCESSOR_URL` is configured.

Production uses the shared private R2 configuration (`R2_ENDPOINT`,
`R2_BUCKET`, `R2_ACCESS_KEY`, and `R2_SECRET_KEY`). Library objects use the
`library/` prefix. Lifecycle rules must never expire the permanent Library
prefix.

## Upload limits by purpose

Every upload declares a purpose, and each purpose has its own maximum file size
and its own authorization rule. The limits are enforced in the API service and
again in `db.CreateLibraryUpload`, so a misconfigured service cannot widen them.
The desktop performs the same check first purely as a convenience.

| Purpose            | Env var                                 | Default |
| ------------------ | --------------------------------------- | ------- |
| `library`          | `MISTY_LIBRARY_MAX_FILE_BYTES`          | 100 MB  |
| `note_attachment`  | `MISTY_NOTE_ATTACHMENT_MAX_FILE_BYTES`  | 15 MB   |
| `drawing_attachment` | `MISTY_DRAWING_ASSET_MAX_FILE_BYTES`  | 15 MB   |
| `attachment`       | `MISTY_CHAT_ATTACHMENT_MAX_FILE_BYTES`  | 10 MB   |

A configured value above the default is rejected at startup rather than clamped.
The `note_attachment` and `drawing_attachment` purposes are never accepted by
the generic Space Library upload endpoint. Journal assets authorize against
their parent note or drawing, so only those resource-scoped routes may create
them.

## Direct R2 transfer

Direct transfer has **no on/off switch**. It is active whenever the configured
object store can sign S3 operations, which in production is always. Routing user
file bytes through the VPS is never the behaviour we want deployed, so there is
deliberately no flag that could be left in the wrong position.

The local and in-memory development stores cannot sign, so they transparently
fall back to the proxy route. That is what lets local development run without R2
credentials for general Library files, and it is the only situation in which
the proxy is used. Journal assets are stricter: note and drawing routes return
`503 journal_asset_direct_transfer_required` when signing is unavailable and
never accept or stream image bytes through the server.

Upload initiation returns an absolute presigned `PUT` URL instead of the relative
`/library/uploads/{uploadID}/content` proxy route, and authorized download
handlers return a signed descriptor (`url`, `expires_at`, `filename`) instead of
streaming bytes. User file bodies never pass through the VPS, which remains the
authorization and metadata control plane.

Only the URL lifetimes are configurable, and both are bounded:

```text
MISTY_R2_UPLOAD_URL_TTL=15m
MISTY_R2_DOWNLOAD_URL_TTL=2m
```

The presigned `PUT` signature covers the exact object key, byte length, content
type, and SHA-256 checksum, so a client cannot substitute different bytes, a
different size, or a different key than the server authorized. Finalization
still HEADs the object and rejects size or checksum mismatches before quota is
committed. The proxy route returns `409 library_direct_transfer_required` whenever the
store can sign, so large bodies cannot silently fall back to the VPS.

Production already refuses to start with a local object store, so a deployed
server always has a signing store and therefore always uses direct transfer.

### Required R2 bucket CORS

Direct transfer will fail in the browser and in packaged Tauri builds until the
bucket allows the exact app origins. Configure the private bucket for `PUT`,
`GET`, and `HEAD` from only the explicit Misty development and packaged origins,
allowing only the signed headers (`Content-Type`, `x-amz-checksum-sha256`,
`x-amz-meta-misty-library-sha256`). Do not use a wildcard origin with
credentials.

## Journal binary assets

BlockNote attachments and Excalidraw images use an R2-only binary path:

1. The client computes SHA-256 and sends only the filename, MIME type, byte
   length, checksum, and (for Excalidraw) binary file ID to the parent-scoped
   upload route.
2. The API rechecks edit access, reserves storage, and signs an exact R2 `PUT`.
3. The client uploads the file directly to R2 without Misty cookies or
   authorization headers.
4. Finalization performs an R2 `HEAD`, verifies the signed size and checksum,
   commits the immutable file reference, and releases the reservation.
5. Readers obtain a short-lived signed R2 `GET`, download directly, and verify
   the response size and SHA-256 before handing it to BlockNote or Excalidraw.

The Excalidraw Yjs document contains only `assetId`, `fileId`, MIME type, and
creation time. It never contains a data URL or other binary image payload.
The Durable Object therefore synchronizes lightweight scene/reference state
only, while R2 carries every image byte.

Relevant drawing endpoints are:

```text
GET    /spaces/{spaceID}/drawings/{drawingID}/assets
POST   /spaces/{spaceID}/drawings/{drawingID}/assets/uploads
POST   /spaces/{spaceID}/drawings/{drawingID}/assets/uploads/{uploadID}/finalize
GET    /spaces/{spaceID}/drawings/{drawingID}/assets/{assetID}/download
DELETE /spaces/{spaceID}/drawings/{drawingID}/assets/{assetID}
```

## Security-domain mapping

The interim approved mapping is implemented: the personal Space uses the owner's
personal domain; each non-personal Space receives its own Space-owned domain.
Cross-domain physical deduplication is prohibited. Future organization domains
can be added without changing `files` or `space_library_items` ownership.

## Remaining gated phases

semantic/visual AI, location Maps, cinematic Memory playback, pinned
collections, stored long-lived exports, and general canonical-file/blob GC
remain gated. Legal-hold-aware two-phase GC is implemented for edit renditions;
the same lease protocol still needs to be extended to every other blob-owning
lifecycle before final Library-wide deletion is enabled.

## Verification

Run all migrations against a fresh PostgreSQL database, then run `go test ./...`.
The integration suite verifies the exact shared-Space quota boundary, concurrent
cross-member reservation enforcement, reservation release, deduplication,
attachment promotion without double charge, edit rendition reservation and
purge accounting, real bounded image/video rendering, ownership limits, and
existing Space behavior. The desktop must pass `npm run typecheck`,
`npm test`, and `npm run build:desktop`.
