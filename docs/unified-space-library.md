# Unified Space Library

The Unified Space Library is an additive, feature-gated replacement for legacy
Space nodes. Existing `space_nodes` data remains available for rollback but is
not migrated into the new Library.

## Implemented foundation

- Personal and Space-owned security domains
- Immutable blobs, canonical files, and Space-scoped Library items
- One shared decimal 1 GB storage pool per Space with atomic upload reservations
- Three owned Spaces total, including Default space
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

## Rollout controls

`MISTY_LIBRARY_ENABLED` is the core kill switch. Uploads, attachments, Groups,
previews, imports, OCR, AI, People, locations, editing, duplicates, and exports
have independent `MISTY_LIBRARY_*_ENABLED` variables. A disabled route must not
be treated as authorization; every enabled operation still checks permissions.

Production uploads require all of the following:

1. `LIBRARY_STORE=r2` or `s3`.
2. A bucket separate from Agent attachments.
3. `LIBRARY_S3_PRIVATE=true` after provider public access is disabled.
4. `LIBRARY_S3_PERMANENT=true` after confirming the short Agent lifecycle rule
   does not apply.
5. `LIBRARY_CLAMAV_ADDRESS` pointing at an isolated scanner.

Production editing additionally requires `LIBRARY_MEDIA_PROCESSOR_BIN` to be an
absolute path to the isolated FFmpeg worker. Development discovers `ffmpeg`
from `PATH` when available. Every render uses server-generated paths, fixed
codecs, bounded threads/time/output bytes, and no shell invocation.

The server refuses development memory/local stores in production and refuses
production uploads without a configured scanner.

## Security-domain mapping

The interim approved mapping is implemented: Default space uses the owner's
personal domain; each non-personal Space receives its own Space-owned domain.
Cross-domain physical deduplication is prohibited. Future organization domains
can be added without changing `files` or `space_library_items` ownership.

## Remaining gated phases

OCR, semantic/visual AI, location Maps, cinematic Memory playback, pinned
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
