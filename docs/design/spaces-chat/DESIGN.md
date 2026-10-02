---
name: Misty Spaces and Chat
description: Compact conversation and cross-type collections in Misty's monochrome shared UI.
colors:
  workspace: "#0f0f0f"
  background: "#131313"
  sidebar: "#161616"
  card: "#191919"
  border: "#262626"
  hover: "#2b2b2b"
  active: "#3e3e3e"
  text: "#e0e0e0"
  text-bright: "#f1f1f1"
  text-muted: "#8c8c8c"
typography:
  title:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "15px"
    lineHeight: 1.6
  label:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "12px"
rounded:
  message: "6px"
  mention: "3px"
components:
  chat-pane:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
  button-primary:
    backgroundColor: "{colors.text-bright}"
    textColor: "{colors.background}"
  reaction-selected:
    backgroundColor: "{colors.active}"
    textColor: "{colors.text-bright}"
---

# Design System: Spaces and Chat

## Overview

This scoped record captures the implemented Discord-inspired compact chat refinement inside Misty's existing visual system. Conversation content carries the page; quiet controls and restrained separators keep switching and actions close at hand. The All collection reuses the same navigation and shared collection patterns.

Shared UI components and `src/styles/styles.css` remain the implementation sources of truth. The palette above records the incumbent monochrome values used here. This record refreshes the approved prototype with the production message layout and interaction behavior; historical prototype screenshots do not override it. Implementation and rollout status are recorded in [INTEGRATION.md](INTEGRATION.md).

## Colors

Use black, white, and neutral gray for interface surfaces, selections, focus, and status. Bright text on a dark surface supplies primary emphasis; a light primary button reverses that relationship. Workspace, sidebar, chat background, and cards use small tonal steps, with borders separating regions.

Muted text carries timestamps, context, and secondary labels. Unread state, read-only permissions, send failures, and favorites use words or icons as well as contrast. Message emoji are content, not a source of interface accent colors. Do not introduce sage, green status dots, tinted selections, or colored focus rings.

## Typography

Retain Inter Variable and the shared UI's type scale. Message authors use the title role and message prose uses the body role. The switcher follows the shared small button typography. Secondary labels use the label role, and the reply preview uses a slightly larger supporting line (13px). Compact timestamps and composer hints are smaller supporting information, not primary actions. Keep message wrapping robust for long unbroken text; truncate long navigation and conversation titles where space is constrained.

## Layout

The Space rail sits beside a flexible main region and keeps Recents below the main navigation even when Chat is open. Shared `WorkspaceSidebar` is 224px wide with 8px padding and a 14px heading. Space links are 32px tall with 13px labels, expanding to a 44px minimum target on coarse pointers. Members and Usage also use 13px labels. Members and Usage are two full-width ghost controls stacked below the divider, without an enclosing box. Recents shows five distinct opened items before Show more. These decisions apply to the Space sidebar and preserve settings sidebar conventions.

Chat keeps its header and composer outside the independently scrolling message history. Each message uses a horizontal two-column layout: a narrow avatar gutter (44px), a gap (16px), and a flexible text column. Author avatars (40px) align with the message body. Repeat-author messages omit the repeated avatar and header and reveal a small time on hover or focus. Date rules separate days without framing every message as a card.

A reply preview spans both columns above the message. Its elbow starts within the avatar gutter and bends toward the quoted line, visually connecting the author below to the reply context. The preview truncates safely while the message body wraps long unbroken text. One floating toolbar sits above the right edge of the row and leaves the text's layout intact.

The conversation picker responds to available header width, including narrow panes: below 600px it uses a bottom Sheet; otherwise it uses a Popover. The fallback without ResizeObserver uses a 700px viewport query. Collections reuse shared responsive list/grid behavior and preserve readable item names and Suggested reasons as space narrows. Shared collection headings are 20px, layout gaps are 16px, and horizontal padding is 16px, increasing to 24px at the small breakpoint. Filters use 13px text in 28px controls; search is 32px tall. The shared composer remains a compact text-and-controls row (52px at rest), grows with its content up to its textarea limit (160px), and places replies and attachment chips above that row. Input text is 14px on desktop and 16px below the medium breakpoint, with matching mention-overlay wrapping.

Production fixture captures cover 1440 × 900, 720 × 900, and 390 × 844. The fixture hides the Space rail on mobile; its screenshots cover the component layout and conversation Sheet, not the full application's mobile navigation Sheet.

## Elevation & Depth

The resting page uses flat tonal regions and thin dividers. Existing shared Popover, Sheet, Dialog, and menu components supply overlay depth and focus behavior. The shared composer frame has no shadow. A message's gray hover/focus surface and the revealed action toolbar show interaction without adding persistent card frames. The toolbar uses the shared small shadow to stay legible over message content. Preserve shared motion and reduced-motion behavior when reusing these components.

## Shapes

Keep the shared UI's gently rounded buttons, inputs, and overlays. Message hover rows and toolbars use the message radius; mentions use the smaller mention radius. Reactions are compact pill chips. Attachments are outlined, icon-led rows with a title and secondary context, rather than large decorative previews.

## Components

- **Navigation and collections:** use `WorkspaceSidebar`, `WorkspaceSidebarHeading`, `WorkspaceSectionLabel`, and the `Collection*` patterns. Lucide icons identify areas and item types. All orders its filters Yours, Suggested, Favorites, without a Recent filter or shortcut block. Favorites use a star and personal add/remove actions, separate from Journal pins and shared Library state. Suggested shows concrete task or Activity attention reasons; Recents belongs in the sidebar.
- **Conversation switcher:** use shared `Command` search and grouped options within `Popover` on desktop and `Sheet` on mobile. A check marks the active chat. Keep New chat and Browse all chats at the end. Closing returns focus to the trigger; the narrow Sheet initially focuses search. New chat uses the existing creation dialog.
- **Messages:** show author, time, prose, reply context, optional attachment, and reaction counts. Hover or focus reveals one floating toolbar. On touch, tapping the focusable message row reveals that same toolbar; do not add a static action row. Reply context connects through the avatar-gutter elbow. Copy remains available in read-only conversations; writing actions follow permissions. Own-message editing happens inline with Save/Cancel, while permitted deletion uses a confirmation dialog that stays open after a failed request.
- **Composer:** use shared `MessageComposer` and `MessageComposerSend`, following the [usage contract](../../../src/shared/ui/patterns/MessageComposer.md). The shared frame owns textarea resizing and control geometry; the Space adapter owns its mention overlay, existing `ChatReplyBanner`, removable attachment chips, draft, and send behavior. Enter sends, Shift+Enter inserts a newline, and IME composition must not send. Read-only chat replaces the composer with its existing permission notice. Retry preserves the failed message's original payload without clearing a newer draft.
- **State feedback:** use clear empty-state copy with an applicable next action, a loading indicator, or a failed-message explanation with Retry. Suggested states explain why an item needs attention; Favorites explains how to populate the view.

## Do's and Don'ts

- **Do** reuse actual shared UI and semantic tokens, preserving keyboard focus and touch access.
- **Do** retain per-conversation draft text, attachments, and reply target within the current account session while switching, and preserve the existing scroll restoration. Scope pending upload completion to its original draft and account session.
- **Do** keep favorites personal across item types and show concrete reasons for Suggested items.
- **Don't** make essential actions hover-only or let long titles crowd out controls.
- **Don't** add decorative containers around Members and Usage or a second persistent chat-navigation column.
- **Don't** treat fixture previews as proof of live delivery, deployment, migration success, or provider authorization. Personal stars and recent references have a server implementation; session drafts remain memory-only.
