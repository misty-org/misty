---
name: Misty Agents Roster and Profile Editor
description: A scoped record of the compact charcoal agent configuration surface.
colors:
  canvas-charcoal: "#131313"
  structural-line: "#262626"
  active-charcoal: "#3e3e3e"
  primary-cream: "#e0e0e0"
  muted-ash: "#8c8c8c"
typography:
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  metadata:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  control: "6px"
spacing:
  control: "8px"
  row: "12px"
  section: "16px"
  form: "20px"
components:
  button-primary:
    backgroundColor: "{colors.active-charcoal}"
    textColor: "{colors.primary-cream}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary-cream}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-disabled:
    backgroundColor: "{colors.canvas-charcoal}"
    textColor: "{colors.muted-ash}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input-default:
    backgroundColor: "{colors.canvas-charcoal}"
    textColor: "{colors.primary-cream}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  roster-selected:
    backgroundColor: "{colors.active-charcoal}"
    textColor: "{colors.primary-cream}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px"
---

# Design System: Misty Agents Roster and Profile Editor

## Overview

**Creative North Star: "The Quiet Operating Desk"**

This scoped record extends the incumbent root DESIGN.md for the roster and profile editor in AgentsPage.tsx. It preserves Misty's restrained charcoal workspace, compact controls, familiar labels, and clear distinction between personal identity and personal app assignments. Root PRODUCT.md and DESIGN.md remain the wider product authority.

The evidence is source code and isolated browser renders of the actual React component with explicitly labeled synthetic profiles, assignments, and memories. It covers desktop and narrow profile layout, neutral checkbox selection, and readable disabled actions. It does not establish native execution, native window behavior, live account integration, or backend permission enforcement. Activity, connection sheets, conversations, and other Agents surfaces are outside this record. No raster assets were created or adopted.

**Key Characteristics:**

- Compact charcoal surfaces with cream text and muted metadata.
- A roster beside a bounded form, stacking at narrow widths.
- Flat sections separated by hairlines and spacing.
- Explicit personal and Space context in concise labels.

## Colors

The profile editor uses the incumbent neutral palette. Frontmatter values record the default theme; live controls inherit the semantic theme variables in src/styles/styles.css.

### Primary

- **Active Charcoal** gives the save action and selected roster row a single tonal emphasis.
- **Primary Cream** carries ordinary labels, content, and the native checkbox accent.

### Neutral

- **Canvas Charcoal** provides both the page and editable field backgrounds.
- **Structural Line** defines field outlines, the roster boundary, and section dividers.
- **Muted Ash** distinguishes helper copy, roster responsibilities, memory scope, and disabled button labels.

**The Neutral Selection Rule.** App selection and roster selection use the established cream and charcoal palette.

## Typography

Native system typography follows the incumbent desktop tool character. The editor uses title, body, label, and metadata roles from the frontmatter; there is no separate display face. The page heading is a compact semibold heading (18px), while editor and empty-state titles use the title role. Field labels use sentence case. Roster names use medium weight; responsibilities and memory scope step down to metadata.

## Layout

At the medium breakpoint (48rem), the roster occupies a fixed column (240px) beside a flexible, independently scrollable editor. Below it, the roster stacks above the editor and the boundary becomes horizontal. The editor form stays bounded (672px maximum), with padding increasing from 20px to 28px at the same breakpoint. The header and action groups wrap.

Repeated controls use 8px vertical and 12px horizontal padding. Roster rows use 12px padding and gaps. Form groups use a 20px vertical rhythm. Section divisions use a single top border and 20px breathing room. This is a profile-editor arrangement, not a mandate for other product pages. Narrow browser evidence does not certify native mobile touch targets or platform behavior.

## Elevation & Depth

The roster and editor are flat at rest. Tonal selection and structural borders carry hierarchy; these components introduce no resting shadows or motion vocabulary.

**The Flat-at-Rest Rule.** Use spacing, a divider, or a tonal step for profile structure; do not add shadows to resting rows and fields.

## Shapes

Buttons, fields, and roster rows share gently curved control corners. Borders are one pixel. Sections remain part of a continuous form rather than nested cards. Checkboxes retain native square control geometry. User-entered avatar emoji are identity content, not a general interface icon system; interface actions use Lucide SVG icons.

## Components

### Buttons

Compact bordered actions use the shared control shape and body typography. Save uses Active Charcoal; secondary actions stay transparent. Enabled hover uses Active Charcoal. Disabled actions use Canvas Charcoal, Structural Line, and Muted Ash at full opacity with an unavailable cursor; they retain their readable label and silhouette. Delete remains a labeled neutral action and reveals inline confirmation.

### Inputs / Fields

Inputs, the model select, and textareas use Canvas Charcoal, a Structural Line outline, and Primary Cream text. Visible labels identify name, avatar, responsibility, instructions, and model. Textareas retain vertical resizing. The system-managed name is read-only. No error-color token is promoted from the one-off error utility.

### Navigation

Roster rows provide a name, truncated responsibility, and identity marker. The selected row uses Active Charcoal and exposes aria-pressed. Hover shares the same tonal fill. The row arrangement follows the responsive layout above.

### App assignments and remembered preferences

Installed app labels sit beside native checkboxes with a neutral cream accent. New assignments start unchecked; an existing profile displays loaded assignments. Apps are labeled as personal and can be assigned without selecting a Space. The Space selector sets work and memory context. Memory rows use body text, a muted scope label, and explicit Edit and Forget actions; editing reuses the shared textarea and buttons. These are observed UI affordances, not evidence of backend isolation.

### Known unresolved review issue

**Finish disposition: fix.** Neutral checkbox selection and readable disabled actions are resolved in the reviewed browser captures. Visible keyboard focus remains open: AgentsPage.tsx declares focus rings for buttons, roster rows, and fields, and an outline for checkboxes, but src/styles/styles.css globally suppresses focus outlines and Tailwind ring shadows with important declarations. The final focus capture does not demonstrate a visible indicator. This suppression is a defect, not normative design guidance or a successful focus treatment. Permission for another review round remains pending in the current workflow.

The sidecar samples expand the component-local focus declarations for isolated preview; they do not reproduce the global suppression and cannot establish that host-page focus is fixed.

## Do's and Don'ts

### Do:

- **Do** reuse the incumbent semantic charcoal and cream theme variables.
- **Do** keep profile sections flat, compact, and separated by spacing or a single divider.
- **Do** retain explicit personal and Space context in labels.
- **Do** preserve readable disabled labels and full control shape.

### Don't:

- **Don't** introduce marketing styling, decorative glows, or a new identity into the profile editor.
- **Don't** make selected app checkboxes a new colored accent.
- **Don't** treat suppressed keyboard focus as a reusable design decision.
- **Don't** present synthetic browser captures as native or live-account validation.
