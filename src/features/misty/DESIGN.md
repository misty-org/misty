---
name: Misty Folder Work
description: Compact shared folder review, recovery and verified receipts within existing Misty conversation surfaces.
colors:
  text: "var(--color-cream)"
  muted: "var(--color-cream-muted)"
  bright: "var(--color-cream-bright)"
  border: "var(--color-charcoal-border)"
  hover: "var(--color-control-hover)"
  active: "var(--color-charcoal-active)"
typography:
  detail:
    fontSize: "12px"
  control:
    fontSize: "14px"
    fontWeight: 500
spacing:
  compact: "4px"
  row: "8px"
components:
  folder-detail:
    textColor: "{colors.muted}"
    typography: "{typography.detail}"
    padding: "4px 0"
  folder-action:
    typography: "{typography.control}"
    height: "32px"
  decision-action:
    textColor: "{colors.bright}"
    typography: "{typography.control}"
    height: "36px"
---

# Design System: Misty Folder Work

## Overview

**Creative North Star: "The Quiet Operating Desk"**

This scoped guide records the shared folder-work extension to the Agents workspace and floating Misty panel. It inherits the established monochrome theme and shared controls from [Agents](../agents/DESIGN.md) and the [overlay](../global-search/DESIGN.md). The folder action stays subordinate to conversation, while proposals and receipts make consequential changes inspectable.

The visual language is compact, plain and operational: quiet controls, readable relative paths, explicit decisions and text-based results. It introduces no new sidebar, display typography, status palette or decorative card system.

**Key Characteristics:**

- One shared folder control and receipt across workspace and popup.
- Readable source → destination changes before approval and in operation history.
- Recovery guidance and disabled approval when the original grant is unavailable.
- Verified effects and undone effects have explicit text and counts.

Source authority: [MistyFolderWork.tsx](MistyFolderWork.tsx), [MistyContextBar.tsx](MistyContextBar.tsx), [folderWork.css](folderWork.css), [shared Button](../../shared/ui/controls/Button.tsx), and the placement in [GlobalMisty.tsx](../global-search/GlobalMisty.tsx) and [AgentWorkspaceConversation.tsx](../agents/components/AgentWorkspaceConversation.tsx).

This record covers the added surfaces. Current native macOS evidence is `desktop.png`, `floating.png` and `recovery.png` in [agent-phases review](../../../.impeccable/review/agent-phases/), each captured at 1280×820. Reviewer approval covers the two scoped fixes—recovery readability and historical documentation clarification—not whole-app acceptance. [Implementation evidence and limits](../../../docs/design/agent-workflows/IMPLEMENTATION.md) remains authoritative: shared lifecycle and bounded native execution are implemented; catalogs remain UI-only; live microphone/speaker acceptance is pending.

## Colors

The approved black, white and gray palette follows the active theme through the frontmatter bindings.

### Primary

Bright text emphasizes Approve and Reject using the shared link button. Emphasis comes from neutral contrast, without a new accent.

### Neutral

Ordinary text carries paths and receipt summaries; muted text carries context, secondary operation results and recovery guidance. The inherited border separates review from adjoining content. Hover and focus use existing neutral shared-control treatments. No state depends on color alone.

## Typography

Inherit the native system UI family. Compact detail text carries folder counts, proposal summaries, review lists, recovery and receipts. Shared buttons retain the ordinary control scale and medium weight. Use brightness and position to distinguish an operation path from its secondary result; do not introduce a display heading for folder work.

## Layout

Place folder work below the popup composer and above the Agents workspace composer. The shared control row wraps with an eight-pixel gap; its context text flexes with a minimum width of 140px. The action changes from “Organize folder” to the selected folder name, followed by the file count and “review before changes.” Removing access stays an adjacent named icon control.

Keep the receipt immediately below the folder controls. Its ordered list scrolls after 240px and wraps long paths anywhere. Proposal review uses a separate native disclosure and a list bounded at 192px. The review container uses a top hairline with 16px horizontal and 12px vertical padding. Preserve the surrounding surface's input hierarchy, dimensions and navigation; this extension adds no responsive breakpoint or sidebar geometry.

## Elevation & Depth

Folder controls and receipts are flat within their host. The proposal review uses a hairline boundary. There are no new shadows, raised cards or animation rules; the existing popup owns its elevation.

## Shapes

Reuse shared Button and IconButton shapes, including their neutral keyboard focus and disabled appearance. Native details/summary disclosures keep receipts and proposed operations compact. Do not wrap the folder row or each operation in a decorative tile.

## Components

**Folder controls:** Use a small ghost button with the existing folder icon. Show access removal beside the active folder. Selection is disabled during work or local operations; Stop changes is available while applying. Inline action failures use an alert. The action is exposed only in the supported native host context; Windows does not expose it.

**Proposal review:** Keep the title, summary, review disclosure and explicit Approve/Reject controls together. With access restored, list each relative source and destination, using “Create folder” for a new directory. While restoring, show “Restoring access to the selected folder…”. If access is unavailable, explain that the user must choose a folder and request a new proposal. Approval remains disabled; rejection does not depend on a surviving local pane. Decision failures remain beside the controls.

**The Readable Change Rule.** File proposals show source → destination paths or explicit access-recovery guidance; file-plan JSON is never the fallback review UI.

**The Original Grant Rule.** Approve stays disabled until the proposal’s original account-owned folder grant is available; Reject remains available without local folder access.

**Operation receipt:** Use a native disclosure with a state-specific summary: Folder organized, Changes paused, or File operation receipt. Include verified counts. A fully undone run has no remaining action, so its receipt is no longer shown beside the composer. Each row shows source → destination and a separate result line, including errors when present. Review-needed receipts open automatically. Resume verified plan appears for resumable states; Undo verified changes appears when completed effects remain. These labels describe the available operation, not a promise that every effect can be reversed.

**The Verified Receipt Rule.** Receipt counts describe verified or undone effects, and each operation retains its own result. A proposal is not a completed change.

## Do's and Don'ts

### Do:

- Do reuse shared buttons and neutral theme tokens.
- Do keep proposed changes, verified effects and undone changes visibly distinct.
- Do keep recovery and errors beside the relevant decision.
- Do let long paths wrap and bound long operation lists with scrolling.

### Don't:

- Don't show raw file-plan JSON while access restores or is unavailable.
- Don't enable approval by substituting a different folder grant.
- Don't imply that removing folder access removes readable history or prevents rejection.
- Don't add colored status signals, decorative shells or a replacement sidebar for this extension.
