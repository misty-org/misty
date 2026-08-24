# Photo and media editing

**Priority:** P3 utility  
**Depends on:** Library  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make media editing a safe, source-preserving collaboration loop where users describe or mark a change, Misty produces reviewable variants, and every result retains provenance.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

The Library viewer supports photo editing, crop controls, versions, metadata, video trimming, playback, and non-destructive edit rendering. Misty can suggest edits and create a guarded image-edit artifact that must preserve the original and render as a new version.

## Compared with a full product

This is a practical asset editor, not Photoshop, Lightroom, Premiere, or Canva. It should cover common project transformations and AI-assisted variants without becoming a professional creative suite.

## Build next

1. Add visual attachment/pixel context instead of relying on metadata alone.
2. Support brushed-region object removal, background replacement, generative fill, expansion, and destination-specific crops.
3. Produce side-by-side variants with apply-as-version, compare, and revert.
4. Generate captions, alt text, palettes, tags, transcripts, chapters, and highlight proposals.
5. Keep deterministic codecs/renderers responsible for conversion and export.

## Production bar

Color/orientation fidelity, cancellation, progress, memory limits, format support, source preservation, rendition retries, provenance, accessibility, and clear disclosures for generated pixels.

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

