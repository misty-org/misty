# Design System: Scheduled

## Overview

Scheduled is an **Operate** workspace at `/scheduled`; `task=<id>` selects a task directly. It has its own calendar-clock navbar destination and reuses its last active tab, including a selected task. Home and `misty://scheduled` open this destination. Legacy `/agents?view=scheduled` links and saved tabs migrate to it.

The supplied ChatGPT Desktop screenshot informs the three-region composition: task roster, primary conversation, and supporting schedule inspector. This extends Misty's existing visual world and shared controls. It is an adaptation of the reference, not a claim of pixel parity. This record applies only to Scheduled and its entry points.

## Colors

Inherit `charcoal-workspace` for the conversation surface, `charcoal-sidebar` for the roster, `charcoal-card` for the inspector, and `charcoal-border` for dividers. Use `cream-bright` for titles, `cream` for body copy, and `cream-muted` for supporting information. Shared controls own hover and selected states; `destructive` marks failures. Shared theme tokens remain the source of truth.

## Typography

Use the app's inherited font with a 14px workspace base. The roster heading is 16px semibold; task names are 14px, and group labels and next runs are 12px. The inspector title is `text-base` medium; empty and conversation-introduction headings are 20px medium. Roster titles truncate while inspector titles and instructions wrap. The center inherits conversation typography.

## Layout

Fill the available workspace tab with a 244px task roster, fluid conversation, and 296px schedule inspector. The roster contains New task, search, and Upcoming/Paused groups. Its list scrolls independently. The center gives the assigned agent and task a compact identity header, then the existing `AgentWorkspaceConversation` transcript and composer. The inspector has 20px padding and a 16px outer margin on its top, bottom, and right.

Responsive behavior uses the workspace's container width. At 1120px and below, an Info control discloses the inspector above the workspace. At 700px and below, a list control discloses a full-width roster; the conversation and inspector are hidden while that roster is open. The composer and transcript retain space for narrow-screen reading and input. Selecting a task closes both disclosures.

## Elevation & Depth

Use flat tonal surfaces and restrained borders. The inset inspector reads as a supporting panel through its card tone and rounded shape; its compact overlay gains a border. The task roster remains a quiet list. The conversation retains the existing transcript's treatment.

## Shapes

The inspector has a 16px radius. Task rows use shared ghost buttons, with at least 54px height and 8px padding. Failures use `rounded-xl` bordered containers. Buttons, agent avatars, editor fields, and dialogs inherit shared shapes.

## Components

- **Task roster:** searchable titles grouped into Upcoming and Paused, with next runs beneath each title. Selected tasks expose `aria-pressed`; loading, retry, no-match, and first-task states provide appropriate feedback.
- **Conversation:** reuse `AgentWorkspaceConversation` for run results and follow-up messages. Guard task changes and leaving Scheduled when a draft is dirty; block navigation during active work. A missing conversation offers retry and explains recovery with the same agent.
- **Inspector:** title, schedule, next run, assigned agent, instructions, run summary, and timezone. Shared buttons provide Run now, Pause/Resume, Edit, and Delete. Run now is disabled for paused or running tasks; deletion confirms and preserves past conversation runs.
- **Editor:** choose an enabled agent when creating a task, then set name, instructions, cadence, and time. Stored agent assignment is immutable: runs and conversation recovery continue with that agent. Editing changes the schedule and instructions without an agent selector.
- **Keyboard and disclosures:** retain shared focus treatments and labeled icon controls. Opening the mobile task list focuses search; closing it restores focus to its trigger. Escape closes the disclosures. The hidden mobile background cannot remain a competing visible interaction surface.
- **Review evidence:** `.impeccable/review/scheduled-chat/` contains `desktop.png`, `mobile.png`, `mobile-details.png`, and `mobile-list.png`, using actual components with illustrative data. Thirty focused UI tests passed, with twelve rerun after fixes. Isolated PostgreSQL checks passed migration backfill, immutable assignment, account ownership, and assignment retention and recovery after conversation deletion. Lint passed; full typechecking reported only two preexisting settings errors. Review found no remaining visual or code findings; these checks do not assert production-data or pixel-parity verification.

## Do's and Don'ts

- Do keep the conversation primary, with task navigation and schedule details supporting it.
- Do preserve Misty's charcoal and cream theme, shared controls, responsive disclosures, and focus restoration.
- Do keep the assigned agent visible and consistent across every run and follow-up.
- Don't introduce production raster assets for this surface; icons and layout are code-native.
- Don't treat this scoped extension as a replacement for global design guidance.
