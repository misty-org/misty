---
name: Misty Provider Directory
description: The shared integration directory for Social, Inbox, Planner, Journal, Library, and Files.
colors:
  canvas-charcoal: "#131313"
  raised-charcoal: "#191919"
  structural-line: "#262626"
  control-line: "#393939"
  hover-charcoal: "#2b2b2b"
  primary-cream: "#e0e0e0"
  supporting-ash: "#a0a0a0"
  focus-ash: "#8c8c8c"
typography:
  heading:
    fontFamily: "system-ui"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.3
  introduction:
    fontFamily: "system-ui"
    fontSize: "15px"
    lineHeight: 1.5
  provider-name:
    fontFamily: "system-ui"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "system-ui"
    fontSize: "13px"
    lineHeight: 1.5
  control:
    fontFamily: "system-ui"
    fontSize: "13px"
rounded:
  control: "6px"
spacing:
  action-gap: "8px"
  compact-gap: "12px"
  row-gap: "16px"
  row-padding: "20px"
components:
  button-default:
    backgroundColor: "{colors.raised-charcoal}"
    textColor: "{colors.primary-cream}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary-cream}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
---

# Design System: Misty Provider Directory

## Overview

**Creative North Star: "The Quiet Operating Desk"**, inherited from Misty's [design system](../../../misty/DESIGN.md) and [product commitments](../../../misty/PRODUCT.md).

This document applies to `PlatformDirectory.tsx`, `platformDirectory.css`, and their consumers in Social, Inbox, Planner, Journal, Library, and Files. `PlatformPanel.tsx` supplies the shared popup frame. It records a narrow extension of the existing dark desktop UI: compact system controls, a continuous integration list, restrained separators, and original brand assets. It does not establish rules for the Browser or other shared components.

## Colors

The charcoal and cream palette follows the active workspace theme. Frontmatter records stylesheet fallback values; runtime `--misty-theme-*` variables remain authoritative. Canvas and raised charcoal distinguish the page and actions. Structural lines divide rows; control lines outline actions. Primary cream carries names and actions, supporting ash carries descriptions, and focus ash outlines keyboard focus. Use the shared brand icon components and preserve their original brand colors; inherently monochrome brands follow the theme.

## Typography

Use native system type. The compact heading introduces the directory; semibold provider names anchor scanning. Introduction copy is larger than row descriptions, while actions share the compact body scale. Hierarchy comes primarily from weight, alignment, and text brightness.

## Layout

The directory scrolls within its workspace and centers content at a maximum width of 760px. Outer padding is 32px vertically and 28px horizontally. Each row aligns a 24px icon slot with 22px artwork, flexible copy, and trailing actions. Provider names use 14px medium type; supporting text uses 11px with a 1.5 line height. Rows share one continuous surface with a bottom hairline.

At viewport widths up to 520px, outer padding becomes 24px by 16px. Copy wraps within its flexible column while the action stays aligned at the trailing edge. Embedded directories use zero outer padding at every width. Touch input uses controls at least 44px tall. This is compact desktop adaptation, not a native mobile shell specification.

## Elevation & Depth

The directory has no shadows or decorative elevation. Tonal action fills, whitespace, and single dividers supply structure. No motion is defined for this surface.

## Shapes

Actions have gently rounded control corners and a minimum desktop height of 30px; search fields are 36px tall. Rows remain unboxed; brand artwork is not placed inside decorative badges or cards.

## Components

- **Integration rows:** Social lists native Misty messaging plus Instagram, Messenger, X, Discord, Slack, and Microsoft Teams. Inbox lists Gmail, Outlook, iCloud Mail, and Yahoo Mail. Keep native Misty messaging accessible through “Open Misty.”
- **Actions:** “Add” opens a provider website and saves its shortcut; “Open” returns to a saved account. The primary action uses the raised fill and structural outline; “Hide” and “Show in sidebar” use transparent secondary styling. Hover uses one charcoal tonal step. Keyboard focus has a two-pixel outline with a two-pixel offset. Pending operations disable their affected actions; the current implementation dims them to half opacity.
- **Account state:** A saved website profile adds its shortcut immediately; it does not prove website sign-in or authorize Misty access. Hiding a shortcut preserves the account session. Website sign-in and mail search authorization remain separate.
- **Feedback:** Loading uses status text. Load, navigation, and sidebar failures provide concise text with Retry. Added and hidden states appear as row copy, with explicit accessible action labels.

Review evidence supplied with this pass: **Ship**, with no material visual findings in `social-desktop.jpg`, `inbox-desktop.jpg`, and `social-compact.jpg` under [the review directory](../../../misty/.impeccable/review/provider-integrations/). Functional validation reports 86 tests and native package flows passing. Real authenticated provider logins remain unverified.

## Do's and Don'ts

- **Do** preserve the existing theme, provider assets, native messaging, and compact list structure.
- **Do** keep Connect, Open, setup, and shortcut visibility states truthful and keyboard accessible.
- **Don't** turn the directory into a card grid or introduce gradients, ambient glows, or oversized imagery.
- **Don't** describe other provider websites as implemented or treat a hidden shortcut as a disconnected account.

Provider webviews use one top bar for navigation, accounts, pins, integrations, and overflow actions. The integration shell never adds a bottom bar; native apps retain their own chrome. Inbox is provider-only and has no native Misty mailbox destination.

The provider toolbar keeps Refresh on the left, website identity, More, and an icon-only dropdown for extra profiles. More holds provider actions; there are no aggregate provider settings pages. Profile creation and pin editing use compact, focused action dialogs. The app catalog keeps one search field and opens provider websites directly. Preserve stored profiles, pins, and browser pointer isolation when simplifying this chrome.

## Shared directory ownership

`PlatformDirectory` imports its own styles through `providers.css`. `platformDirectory.css` owns search, row layout, type, icons, controls, feedback, and narrow-width behavior. Do not style directory internals through `.integration-dialog` ancestors or rely on `websites.css` imports. `data-embedded` changes only the outer frame. Both standalone directories and popups use identical rows. The popup retains its existing heading, close/back actions, bounded scroll body, and focus restoration.
