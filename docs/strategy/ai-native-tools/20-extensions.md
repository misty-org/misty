# Extensions

**Priority:** P4 ecosystem  
**Depends on:** Files; Agents  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Extensions the safe capability layer that lets Misty gain specialized deterministic tools without turning arbitrary plugins into unrestricted agents.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Extensions has a catalog, search, detail view, declared capabilities/permissions, install/enable/disable/uninstall behavior, panels and commands inside Files, and six bundled extensions: Backups, Image Optimizer, Quick Convert, Storage Report, Themes, and yt-dlp. Misty can explain or compare catalog entries and propose installation only when the exact permission list matches the manifest.

## Compared with a full product

It is an early capability marketplace, not the Chrome Web Store or VS Code Marketplace. Its value is extending what Misty and agents can safely do with typed inputs and outputs.

## Build next

1. Search by desired outcome and current selection, not only name/category.
2. Explain why an extension matches, where it appears, what leaves the device, and each permission.
3. Expose extension commands as typed Misty actions with previewable inputs/outputs.
4. Compose compatible extension steps into a reviewed workflow.
5. Add verification, signing, compatibility, update notes, rollback, health, and crash isolation.
6. Provide a developer kit with schemas, test fixtures, permission linting, and accessibility checks.

## Production bar

Signed packages, reproducible checksums, sandboxing, permission enforcement, safe tool binaries, rollback, dependency isolation, compatibility policy, update channels, telemetry boundaries, and a review process.

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

