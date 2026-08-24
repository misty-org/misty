# Code

**Priority:** P3 execution  
**Depends on:** Misty companion; Files; Terminal  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Code a collaborative implementation surface where the user and Misty inspect the same repository state, negotiate a change, review multi-file diffs, run evidence-producing checks, and hand off longer work to a coding agent.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Code is a lightweight IDE with project explorer, tabs and multibuffers, CodeMirror editing, search, diagnostics, LSP features, symbols, references, rename, formatting, inlay/signature support, embedded terminal, file watching, preferences, and inline rewrite. The shared Misty adapter currently reasons over and patches only one bounded active buffer; it does not yet perform repo-scale edits or a test loop.

## Compared with a full product

It is not yet VS Code or Cursor. Misty should treat it as an integrated implementation surface for small-to-medium work and agent review, while allowing handoff to external IDEs for specialized workflows.

## Build next

1. Add exact editor selection and diagnostic context to the shared adapter.
2. Add repository search, symbols, references, diagnostics, git diff, and terminal output as attachable typed context.
3. Support multi-file patch artifacts with per-hunk accept/reject and stale-base detection.
4. Run format/typecheck/test commands as explicit evidence attached to the proposal.
5. Add background coding tasks that return a branch/diff/artifact rather than silently editing the working tree.
6. Support project instructions and respect repository policies.

## Production bar

Reliable file encoding/newlines, autosave/recovery, LSP lifecycle, large repositories, git integration, diff fidelity, terminal sandboxing, language coverage, extension strategy, accessibility, and no dependency install/push/publish without elevated approval.

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

