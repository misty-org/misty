# Design System: Scheduled

## Overview

Scheduled is an **Operate** workspace at `/scheduled`; `task=<id>` selects a task directly. It has its own calendar-clock navbar destination and reuses its last active tab, including a selected task. Home and `misty://scheduled` open this destination. Legacy `/agents?view=scheduled` links and saved tabs migrate to it.

The approved Spaces and Scheduled screenshot direction informs the shared roster and welcome composition; selecting a task retains the primary conversation and supporting schedule inspector. This extends Misty's existing visual world and shared controls. It is an adaptation of the reference, not a claim of pixel parity. This record applies only to Scheduled and its entry points.

## Colors

Inherit `charcoal-workspace` for the conversation surface, `charcoal-sidebar` for the roster, `charcoal-card` for the inspector, and `charcoal-border` for dividers. Use `cream-bright` for titles, `cream` for body copy, and `cream-muted` for supporting information. Shared controls own hover, selected, focus, and failure states; do not add a surface-specific palette. Shared theme tokens remain the source of truth.

## Typography

Use the app's inherited font with a 14px workspace base. The roster heading is 18px semibold; task names are 14px, and group labels and next runs are 12px. The inspector title is `text-base` medium; the welcome heading is 20px medium, and conversation-introduction headings are 20px medium. Roster titles truncate while inspector titles and instructions wrap. The center inherits conversation typography.

## Layout

Fill the available workspace tab with the shared 240px task roster and fluid main region. With no task selected, `WorkspaceWelcome` presents concise suggestions in a centered region capped at 736px, with two suggestion columns. Selecting a task opens the existing `AgentWorkspaceConversation` transcript and composer with a compact identity header. Upcoming tasks sort by next run; Paused tasks form a separate group. The roster contains New task, search, and a status-filter dropdown, and its list scrolls independently.

This is a desktop-only shell. The 240px roster remains visible beside the main region. When schedule details are shown, a 288px inspector with 16px padding holds a shared Card with 20px padding. The roster and inspector remain in the desktop layout at every window width. Shared dialogs retain their existing focus and dismissal behavior.

## Elevation & Depth

Use flat tonal surfaces and restrained borders. The inset inspector reads as a supporting panel through its card tone and rounded shape; its desktop visibility follows the details control. The task roster remains a quiet list. The conversation retains the existing transcript's treatment.

## Shapes

The inspector inherits the shared Card radius (12px). Task rows use shared ghost buttons, with at least 56px height, 8px horizontal padding, and 12px vertical padding. Failures use `rounded-xl` bordered containers. Buttons, agent avatars, editor fields, and dialogs inherit shared shapes.

## Components

- **Task roster:** searchable titles grouped into Upcoming and Paused, with next runs beneath each title. Selected tasks expose `aria-pressed`; loading, retry, no-match, and first-task states provide appropriate feedback.
- **Conversation:** reuse `AgentWorkspaceConversation` for run results and follow-up messages. Guard task changes and leaving Scheduled when a draft is dirty; block navigation during active work. A missing conversation offers retry and explains recovery with the same agent.
- **Inspector:** title, schedule, next run, assigned agent, instructions, run summary, and timezone. Shared buttons provide Run now, Pause/Resume, Edit, and Delete. Run now is disabled for paused or running tasks; deletion confirms and preserves past conversation runs.
- **Editor:** choose an enabled agent when creating a task, then set name, instructions, cadence, and time. Scheduled loads agents directly, resolves the default when agents arrive after the editor opens, and offers retry on loading failure. The blank agent field and disabled Create action were corrected and verified in live Misty; no real schedule was saved during QA. Stored agent assignment is immutable: runs and conversation recovery continue with that agent. Editing changes the schedule and instructions without an agent selector.
- **Keyboard and disclosures:** retain shared focus treatments and labeled icon controls. Preserve shared dialog focus, dismissal behavior, and keyboard access to task selection and schedule details.
- **Shared implementation:** roster, welcome, and suggestions use `CollectionWorkspace.tsx`; menus, editor controls, cards, and dialogs use the existing shared UI. Bespoke `scheduledWorkspace.css` has been removed. Suggestions only prefill the editor for user review.
- **Review evidence:** [Spaces and Scheduled DESIGN.md](../../../docs/design/spaces-scheduled/DESIGN.md) records the current source-labelled comparison, production-component fixtures, live Misty captures, and checks. Live Codex inspection was blocked by computer-use safety; the reference is supplied screenshots. SHIP covers screenshot fidelity and inspected code, not live Codex parity or all actions. `.impeccable/review/scheduled-chat/` records the earlier conversation integration; its historical geometry and validation limitations do not describe the current shared implementation. All preview datasets are illustrative, not live-account evidence.

## Do's and Don'ts

- Do keep the conversation primary, with task navigation and schedule details supporting it.
- Do preserve Misty's charcoal and cream theme, shared controls, desktop shell, and focus restoration.
- Do keep the assigned agent visible and consistent across every run and follow-up.
- Don't introduce production raster assets for this surface; icons and layout are code-native.
- Don't treat this scoped extension as a replacement for global design guidance.

The roster uses standard shared New task and selection controls. Search uses the shared InputGroup composition; editor Input and OptionSelect controls use their standard shared radii. Secondary detail actions share a compact NavIsland, while Run now remains separate. All default shared styles on unrelated pages remain unchanged.

Current desktop-shell authority is [Journal entry pages](../../../docs/design/journal-entry-pages/DESIGN.md).

## Agents integration

Scheduled is a section of the full-width Agents collection at `/agents?view=scheduled`. Creation and editing reuse `ScheduledTaskEditor`; selected tasks open the existing conversation/details workspace at `/agents?view=scheduled&task=…`. Its Back action uses the existing draft guard. The global Scheduled navbar destination is removed. Old `/scheduled` links and persisted Scheduled tabs migrate into Agents without losing task selection. Prior standalone-entry descriptions are superseded; execution, permission, account, and editor rules remain authoritative. Shared button groups have no outer container chrome. Desktop-only remains the shipping scope.
