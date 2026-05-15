# Drawings

**Priority:** P1 collaborative core  
**Depends on:** Spaces; Misty companion  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Drawings a live visual collaboration surface where a person can describe, sketch, select, and reshape ideas while Misty creates and edits native objects in view.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Drawings is a collaborative Excalidraw surface with Yjs presence, cursor following, shared binary assets, permissions, and Figma references. Misty can inspect a bounded scene/selection and currently apply only constrained x/y updates to selected elements. The UI advertises layout improvement and diagram creation, but the current client patch contract cannot yet create shapes, text, or connectors.

## Compared with a full product

It is a collaborative whiteboard, not Figma Design, Illustrator, or a full Miro replacement. Its strategic job is shared visual thinking and rapid structured diagrams.

## Build next

1. Expand the drawing operation schema to validated create/update/delete/group/connect operations for a safe subset of Excalidraw objects.
2. Make “draw a cube” visibly construct native elements on the canvas, with Cancel and Undo.
3. Support selection-scoped alignment, cleanup, labels, clustering, connector repair, and style matching.
4. Generate flowcharts, mind maps, wireframes, and sticky-note sets from prompts or selected notes.
5. Let the user interrupt or manipulate generated objects while Misty adapts to the new scene revision.
6. Add canvas outline, alt text, OCR, and conversion from visual clusters into Notes or Planner items.

## Production bar

Scene versioning, deterministic operation validation, one-transaction Undo, large-canvas performance, asset lifecycle, export/import, keyboard accessibility, collaboration conflict tests, and no unrestricted model-authored Excalidraw JSON.

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

