# Terminal

**Priority:** P3 execution  
**Depends on:** Misty companion; multi-pane workspace  
**Source plan:** [Misty AI-Native Tool Plan](../ai-native-tool-plan.md)

## Codex thread objective

> Make Terminal a shared execution conversation where Misty can observe bounded output, propose the next step, and operate only under visible session-scoped control.

Use this file as the scope for a dedicated Codex thread. Start by validating the current implementation against this brief. Then turn the work into staged, testable slices and implement the highest-leverage coherent slice that fits the thread’s authorization. Preserve existing user work and keep the non-AI tool useful when AI is unavailable.

## What exists now

Terminal supports real local PTYs, SSH environments, session state, clipboard/search/zoom shortcuts, configurable appearance/scrollback, and workspace persistence. Misty receives a redacted visible buffer and can explain, diagnose, summarize, security-check, or stage exactly one validated command into the input buffer. Acceptance does not execute it automatically.

## Compared with a full product

It is a solid embedded terminal rather than iTerm, Warp, or a complete SSH manager. Its value is making execution observable and safely collaborative.

## Build next

1. Represent command blocks, exit codes, timestamps, cwd, and selected output structurally instead of sending only a text snapshot.
2. Trigger one dismissible “Explain failure” nudge after a non-zero exit when enabled.
3. Add command preview with risk, effect, cwd, environment, and rollback before staging.
4. Define separate Observe, Propose, Write, and Execute capabilities for one PTY.
5. Add Agent mode with state labels, per-command approvals, Stop, and Take over.
6. Improve secret detection and show the user the exact redacted context before sending.

## Production bar

PTY correctness, SSH host-key verification, reconnect, Unicode, resize, process cleanup, paste protection, secrets, shell integration, performance, accessibility, and zero hidden command execution.

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

