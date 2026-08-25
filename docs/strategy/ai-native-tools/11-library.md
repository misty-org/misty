# Library

**Priority:** P2 context  
**Depends on:** Spaces; Files  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Library the durable, permissioned memory of a Space: every important artifact is understandable, retrievable, reusable, connected to its origin, and safe for people and agents to cite.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

The Space Library is a substantial shared asset system with uploads, collections, albums, people, dates, imports, shared references, duplicates, protected collections, versions, metadata, image/video viewing and editing, and Smart Library analysis/search. Misty currently receives selected item references and can synthesize, compare, organize, or suggest related searches.

## Compared with a full product

It sits between Dropbox/Drive, a digital asset manager, and Photos. Its Misty-specific role is curated project memory—not a raw mirror of every local file.

## Build next

1. Resolve authorized item content, captions, OCR, transcripts, and time-coded segments through the Context Broker.
2. Add “ask about selection” with page/slide/timecode citations.
3. Support semantic related-items, duplicate review, best-version suggestions, and organization proposals.
4. Convert selected assets into a Note, task plan, drawing reference, presentation brief, or chat attachment.
5. Preserve generated metadata separately from human metadata with model/version/input provenance.
6. Let agents deposit outputs directly into the correct collection with a clear source/run trail.

## Production bar

Large-library pagination, resumable upload, checksum/integrity, permissions, deletion recovery, rendition reliability, search quality, metadata portability, format coverage, storage quotas, and user-controlled reanalysis/deletion.

## Required thread outputs

1. A current-code audit that confirms or corrects this brief.
2. A staged implementation plan with dependencies and explicit non-goals.
3. The coherent product slice implemented in that thread, with proportional tests.
4. Desktop-specific verification when native behavior, pointer behavior, captures, webviews, files, PTYs, or OS integration are involved.
5. A concise handoff listing completed behavior, remaining gaps, risks, and the next recommended slice.

## Shared acceptance gate

- The underlying tool remains dependable without AI.
- Context sent to Misty is visible, bounded, removable, and permission-correct.
- AI output becomes a native artifact or native proposal rather than copy/paste text.
- Consequential changes are previewable, conflict-checked, attributable, and recoverable.
- The interaction works with keyboard navigation and respects reduced motion where applicable.
- Failures, stale state, cancellation, navigation, and restart behavior are intentionally handled.

