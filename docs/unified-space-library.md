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
