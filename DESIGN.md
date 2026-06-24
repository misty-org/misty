---
name: Misty Product Workspace
description: A quiet, dense, charcoal operating environment for focused work alone or together.
colors:
  workspace-black: "#0f0f0f"
  canvas-charcoal: "#131313"
  sidebar-charcoal: "#161616"
  raised-charcoal: "#191919"
  structural-line: "#262626"
  hover-charcoal: "#2b2b2b"
  active-charcoal: "#3e3e3e"
  primary-cream: "#e0e0e0"
  bright-cream: "#f1f1f1"
  muted-ash: "#8c8c8c"
  avatar-red: "#eab7ab"
  avatar-orange: "#f0c38e"
  avatar-yellow: "#f0d58c"
  avatar-green: "#c5cf8e"
  avatar-aqua: "#a8d1b3"
  avatar-blue: "#a0c4d4"
  avatar-purple: "#d3b3c9"
  avatar-gray: "#d5c9b8"
  avatar-ink: "#3c3836"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  subtitle:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  control:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  dense:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "normal"
  metadata:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "normal"
  micro:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  control: "6px"
  panel: "8px"
  card: "12px"
  overlay: "16px"
  pill: "999px"
spacing:
  hairline: "1px"
  compact: "4px"
  control: "8px"
  row: "12px"
  section: "16px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.active-charcoal}"
    textColor: "{colors.bright-cream}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ash}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px"
    height: "36px"
  input-default:
    backgroundColor: "{colors.raised-charcoal}"
    textColor: "{colors.primary-cream}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "36px"
  control-disabled:
    backgroundColor: "{colors.canvas-charcoal}"
    textColor: "{colors.muted-ash}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "36px"
  card-default:
    backgroundColor: "{colors.raised-charcoal}"
    textColor: "{colors.primary-cream}"
    rounded: "{rounded.card}"
    padding: "16px"
  navigation-row:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ash}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "36px"
---

# Design System: Misty Product Workspace

## Overview

**Creative North Star: "The Quiet Operating Desk"**

Misty should feel like a serious desktop environment that disappears behind the work. The supplied Inbox, Planner, and Files references establish an almost-monochrome charcoal field whose structure comes from alignment, narrow tonal steps, and fine dividers rather than decorative containers. The interface is compact and calm: a person can scan a great deal of information without feeling that every object is competing for attention.

The workspace may contain many different tools, but all of them should feel built into the same operating environment. Shell chrome, sidebars, toolbars, tables, boards, empty states, and overlays share one density and one interaction language. Black, white, and gray are the default for every surface, control, selection, focus indicator, badge, and status. Optional color accents use only the soft pastel family already used by Space and person avatars; color is never required to make a control look active or important.

**Key Characteristics:**

- Dark, tonal, and low-glare rather than pure black and high-contrast.
- Dense desktop-tool rhythm with generous empty canvas where the task benefits from it.
- Hairline structure, compact controls, restrained rounding, and almost no ornament.
- Clear hierarchy through weight, alignment, and brightness before size.
- Monochrome chrome and interaction states; rare pastel accents for meaningful identity or information.

## Colors

The primary palette is black, white, and gray: a compressed charcoal ladder, off-white text, and ash metadata. There is no signature brand accent color. Existing token names such as Cream refer to the neutral gray values listed below.

### Brand identity

- **Misty Logo**: Always monochrome. Use warm white on dark surfaces and near-black on light surfaces, inheriting the surrounding foreground color so the mark stays consistent across themes. Keep the original silhouette unchanged.
- **Integration logos**: Use the original brand SVG colors and gradients in navigation, tabs, Discover, connection screens, and app views. Reuse `misty-apps/apps/shared/brandIcons.ts` everywhere. Preserve brand colors on inactive rows; show selection through the surrounding neutral background. Inherently monochrome brands use their light or dark foreground variant. Misty tool icons remain monochrome.

### Primary: monochrome

Use neutral tones for navigation, tabs, buttons, links, focus rings, source icons, unread indicators, notification counts, and status labels. Selected controls gain brightness, weight, a neutral underline, or one tonal fill. Success, collaboration, and agent-related UI do not automatically earn green.

- **Workspace Black** (#0f0f0f): The deepest shell and rail layer.
- **Canvas Charcoal** (#131313): The primary tool canvas and application background.
- **Sidebar Charcoal** (#161616): Persistent navigation and supporting panes.
- **Raised Charcoal** (#191919): Cards, selected rows, fields, and compact floating surfaces.
- **Structural Line** (#262626): Hairline borders, separators, pane boundaries, and table rules.
- **Hover Charcoal** (#2b2b2b): Transient hover and highlighted menu states.
- **Active Charcoal** (#3e3e3e): Filled primary actions, strong selection, and focus reinforcement.
- **Primary Cream** (#e0e0e0): Default readable text and icons.
- **Bright Cream** (#f1f1f1): High-emphasis titles, active labels, and current values.
- **Muted Ash** (#8c8c8c): Secondary labels, metadata, placeholders, and inactive navigation.

### Optional accents: the avatar pastel family

Reuse the existing avatar tokens from `src/styles/styles.css` and `src/shared/lib/avatarPalette.ts`: soft red (#eab7ab), orange (#f0c38e), yellow (#f0d58c), green (#c5cf8e), aqua (#a8d1b3), blue (#a0c4d4), purple (#d3b3c9), and warm gray (#d5c9b8). Pastel avatar fills use dark ink (#3c3836).

These are a restrained family, not a new primary color. Prefer them for Space/person identity and occasional semantic distinctions where color adds useful information. Keep the surrounding UI neutral. Do not substitute saturated indigo, red, or a pervasive sage accent. A mention, unread item, or pending request may remain entirely monochrome; use text, icons, weight, and shape to convey its state. Any colored state must also have a non-color cue and sufficient contrast.

Original third-party logos and user content retain their own colors as content, not as a palette for Misty's controls.

### Named Rules

**The Tonal Ladder Rule.** Establish hierarchy by moving one step through the charcoal scale; do not introduce a new gray for each component.

**The Monochrome-First Rule.** Always start with black, white, and gray. Selection, focus, action importance, and notifications use neutral contrast by default; no generic green or other colored accent.

**The Earned Pastel Rule.** Optional accents must come from the avatar pastel family and communicate specific identity or information. Decorative gradients, ambient color washes, and arbitrary colored cards do not belong in the product UI.

## Typography

**Display Font:** System UI with native platform fallbacks
**Body Font:** System UI with native platform fallbacks
**Label/Mono Font:** System UI for labels; SFMono-Regular, Menlo, or the platform monospace for code and terminal content

**Character:** Native, neutral, and highly legible. Typography behaves like application chrome: direct, familiar, and optimized for repeated scanning rather than brand theater.

### Hierarchy

- **Title** (600, 18px, 1.25): Tool titles, dialog headings, and important selected-object titles; slight negative tracking keeps compact headings crisp.
- **Body** (400, 15px, 1.5): General content, controls, and readable supporting copy.
- **Compact Body** (400–500, 14px, 1.4): Dense lists, planner cards, tables, navigation rows, and toolbars.
- **Label** (500–600, 12px, 1.25): Metadata, status, section labels, keyboard hints, and table support text.
- **Micro Label** (500, 10–11px, 1.2): Counts and compact status only; never use for essential actions or long sentences.

### Named Rules

**The Brightness-Before-Size Rule.** Create most hierarchy with weight and cream-to-ash contrast; reserve size jumps for true page or object titles.

**The Sentence-Case Rule.** Controls and navigation use familiar sentence case. Avoid ornamental all-caps except tiny technical labels where the incumbent surface already uses them.

## Layout

Misty is a full-height workspace with two deliberate shells. Desktop is split-capable, with a compact title/tab band, persistent navigation, optional tool-specific sidebars, and flexible work canvases separated by one-pixel rules. Native mobile projects that workspace into one active surface without changing its panes, tabs, or virtual windows. Toolbars generally occupy 36–44px on desktop; mobile controls use at least 44×44px targets.

### Apple mobile shell

- iPhone and narrow iPad layouts use a safe-area-aware top bar and a fixed bottom bar: Home, Chat, Planner, Inbox, More.
- iPad layouts at least 1024 CSS pixels wide replace More with a persistent 280px sidebar, while still showing only one independent workspace surface.
- Mobile sheets are full-height or bottom anchored, account for the home indicator and software keyboard, and never rely on hover.
- Inputs remain at least 16px. The shell supports a 320px minimum width, landscape rotation, large text, coarse pointers, and reduced motion.
- Desktop-only splits, resizers, pane movement, tab dragging, window chrome, pet controls, extension storefronts, and shortcut configuration do not appear in the mobile hierarchy.

Use an 8px control rhythm and 12–16px row or section rhythm. Major tool areas align to shared vertical boundaries. Sidebars should be narrow enough to preserve the canvas, but labels must truncate predictably and icons must remain stable. Large empty regions are acceptable in boards, previews, and editors when they represent working space; do not fill them with decorative cards.

On tablets, preserve the same hierarchy and tonal language while allowing navigation and supporting panes to overlay or collapse. Maintain comfortable touch targets for primary actions even when visual density remains compact. Never rely on hover to reveal the only path to an action.

**The One-Chrome Rule.** A surface gets one structural shell. Tool content should not rebuild the full application frame inside itself.

**The Continuous-Canvas Rule.** Prefer dividers and tonal changes over card grids when content belongs to one working surface.

### Discover catalog

Discover uses a fixed navigation rail (176px), full-width search, wrapping category filters, and one continuous list with compact rows (84px minimum). Its layout responds to the pane’s container width: metadata narrows at 1080px; at 820px the rail becomes horizontal navigation and metadata hides; at 440px row icons, gaps, and actions compact further. These are desktop pane adaptations; native mobile storefront availability remains governed by PRODUCT.md.

## Elevation & Depth

The system is flat by default. Persistent structure uses tonal layering and hairline borders. Shadows are reserved for elements that physically float above the workspace—menus, dialogs, sheets, temporary navigation islands, drag previews, and transient notices. Resting cards and table rows should not cast shadows.

### Shadow Vocabulary

- **Compact Float** (`0 12px 30px rgba(0,0,0,0.5)`): Floating navigation islands and small detached controls.
- **Navigation Float** (`0 18px 44px rgba(0,0,0,0.6)`): Auto-revealed navigation above the workspace.
- **Overlay Lift** (Tailwind `shadow-xl` or `shadow-2xl` plus a subtle cream ring): Dialogs, sheets, menus, and high-layer popovers.

### Named Rules

**The Flat-at-Rest Rule.** If an element does not overlap another surface, it usually needs a divider or tonal step, not a shadow.

## Shapes

Controls use gently curved corners, usually 6px. Panels and empty-state targets use 8px; task cards use 12px; large dialogs and workspace overlays may use 16px. Pills are reserved for badges, avatars, presence, segmented toggles, and genuinely compact status—not as a default container shape.

Borders are one pixel and low contrast. Selected navigation is expressed through a slim edge marker, a single tonal fill, or both. Avoid stacking bordered rounded containers inside one another; nested structure should usually become spacing and dividers.

**The Radius-Follows-Scale Rule.** A component earns a larger radius only when its physical footprint and layer increase.

## Components

### Buttons

- **Shape:** Compact gently curved control (6px), normally 32–36px high.
- **Primary:** Active charcoal with bright cream text. The fill is sober and neutral; use it for the action that advances or commits the current task.
- **Hover / Focus:** Filled controls brighten by one tonal step. Unfilled controls primarily brighten their icon or text. Keyboard focus uses a visible charcoal ring and border change without neon glow.
- **Secondary / Ghost:** Secondary controls may use raised charcoal; ghost and toolbar controls remain transparent until interaction.
- **Disabled:** Replace interactive fill with canvas charcoal, retain a structural border, and use muted ash for text and icons. Do not rely on opacity alone; switches and sliders must also flatten their movable marker so they cannot be mistaken for an available off state.

### Chips

- **Style:** Compact pills with short labels. Neutral chips use the charcoal ladder; priority or status chips remain neutral by default; a useful semantic distinction may use one avatar-pastel fill with dark ink and an explicit label.
- **State:** Selected filters use a single filled tonal step. Do not assemble long toolbars from many colored status pills.

### Cards / Containers

- **Corner Style:** Gently rounded to medium (8–12px).
- **Background:** Raised charcoal on the canvas, with workspace black or canvas charcoal for nested editable regions.
- **Shadow Strategy:** None at rest.
- **Border:** One structural line; avoid double borders and cards inside cards.
- **Internal Padding:** 12–16px for dense work cards, up to 24px for larger settings or explanatory panels.

### Inputs / Fields

- **Style:** Raised charcoal field, one structural border, 6px corners, compact 36px control height, and ash placeholder text.
- **Focus:** Strengthen the border and add a restrained focus ring; do not change layout or add luminous effects.
- **Error / Disabled:** Errors use concise copy, an explicit error icon or label, and a clear recovery action. Default to neutral contrast; optional error color uses the soft avatar-red token, never a saturated red accent. Disabled controls retain their full shape and readable label, step down to canvas charcoal and muted ash, and remove interactive depth. Dependency-disabled rows may also move one tonal step darker so the unavailable relationship is visible at a glance.

**The Disabled-Is-a-State Rule.** A disabled control must differ from both its enabled and ordinary off states through surface, border, and marker treatment; opacity alone is never sufficient.

### Navigation

Persistent navigation is quiet by default: ash labels and icons on workspace black or sidebar charcoal. Hover moves toward cream and may add one raised-charcoal tonal step. The current location uses bright cream plus a small edge marker or a single selected row fill. Section headings are compact and stronger than their children, not oversized.

### Activity

Activity uses one feed with a Discover-style horizontal section container: All, Unread, Mentions, System. Each section shows its matching entry count after search and filters, independently of selection. Counts remain neutral, including zero, and differ from the bell’s attention badge. Place background-free filter, sort, and search controls on the right; on mobile, place them below the horizontally scrollable sections. Search expands to a full-width input. Use a prominent 20px title and 22px bell. Use compact containers and spacing for hierarchy, without divider rules between the header, toolbar, feed, footer, or card contents. Keep the title row 48px high, section buttons and icon controls 28px high, using Discover’s actual toolbar classes and spacing (including its coarse-pointer sizing), and the popup capped at 560px or 75dvh. The footer contains Mark all read and Clear all, changing to Mark filtered read and Clear filtered when narrowed. Actions affect all matching entries, preserving unresolved requests. Read entries stay in All. Keep source names and compact source-header cards without repeated Activity icons. All generic icons, labels, focus indicators and badges are monochrome; existing avatar identity colors may remain pastel. The popup preserves the workspace, with Close in the title row and an independently scrollable feed.

### Tables and Lists

Rows share one continuous surface, separated by hairlines. Unread, selected, or focused state may change weight and move one tonal step. Preserve stable columns, predictable truncation, and right-aligned metadata so dense information remains easy to compare.

### Discover apps and details

Discover shares the active workspace theme variables, native system typography, and hairline structure. App names use compact semibold type (15px); descriptions and actions step down to 13px, with metadata at 12px. Featured, Apps, and Installed are the only section destinations. Rows use the existing official app icons and monochrome verification mark, with theme-card emphasis on hover or focus. The bright filled Add action retains canvas-colored text through hover; Open uses a quiet bordered action.

Selecting an app or Add opens a focused details dialog with About, Permissions, and Where it appears. The body scrolls independently while the heading and action footer remain visible; closing restores focus to the originating control. Catalog facts and action states come from the existing official app catalog and installations, including update, unavailable, and removal states. Preserve that review-before-install flow and the existing install/remove semantics. Approved mockups are visual references only; generated mockup imagery is not a shipped asset.

### Workspace Chrome

Virtual windows own layout tabs; each layout tab owns headerless panes with one app view per pane. Keep the original 38px top bar and compact tab buttons. Multi-pane tabs show a pane-count dropdown with focus and close controls for each pane; single-pane tabs show only a close button. Tab names follow the focused pane unless renamed. Split controls create blank panes with a Choose app button. New tabs and final-tab fallbacks open the blank Choose app page. Closing with the tab shortcut removes the focused pane before closing the final single-pane tab. Pane focus defaults to 15% inactive dimming with no active border; dimming and optional outlines/borders are independent Appearance settings.

Tabs, split panes, title bands, rail controls, and bottom status bars should read as one operating system. Keep their heights, border strength, hover behavior, and icon scale consistent across tools. Product content must never compete visually with window or workspace chrome.

## Do's and Don'ts

### Do:

- **Do** preserve the compact, dark desktop-tool character shown in the supplied Inbox, Planner, and Files references.
- **Do** reuse the established charcoal ladder and shared UI primitives before creating a new value or component.
- **Do** establish hierarchy through alignment, weight, brightness, and one-pixel structure.
- **Do** keep controls compact, scannable, keyboard operable, and understandable without hover.
- **Do** make disabled controls visibly inert while keeping their labels readable and their original shape intact.
- **Do** keep UI chrome, interaction states, and notifications monochrome by default. Use only the avatar pastel family for optional, meaningful accents.
- **Do** let large working canvases remain open when empty space serves the task.

### Don't:

- **Don't** introduce gradients, glassmorphism, colorful ambient glows, or marketing-page aesthetics into product surfaces.
- **Don't** wrap every section in a rounded card or nest cards inside cards.
- **Don't** use oversized headings, oversized empty-state illustrations, or generous landing-page spacing in dense tools.
- **Don't** turn every control into a pill or apply large radii to small elements.
- **Don't** use pure black and white when the established charcoal and cream tokens provide the intended lower-glare contrast.
- **Don't** add color merely to make a monochrome page feel more exciting, or treat sage, green, indigo, or red as a default accent.
- **Don't** rewrite factual product copy or invent integrations, proof, testimonials, or capabilities while polishing the UI.
