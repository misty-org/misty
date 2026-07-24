# Misty Design System

Misty uses a quiet, tool-first interface based on the shadcn `radix-vega` style and the Zinc color family. It should feel precise, calm, and native to a serious desktop workspace: dense enough for daily use, but never cramped or visually noisy.

This document is the design contract for new screens and for changes to existing UI.

## North Star

Misty should look like a focused desktop tool, not a marketing website.

- Use neutral surfaces, restrained contrast, and clear hierarchy.
- Let content and actions carry the experience; decoration should stay secondary.
- Prefer a few well-defined surfaces over stacks of cards.
- Keep controls compact, predictable, and aligned.
- Use color to communicate state, not to decorate.
- Preserve the same visual grammar across Files, Spaces, Agents, Extensions, and settings.

The default reference is dark Zinc. Light mode and custom themes must use the same semantic roles and hierarchy.

## Foundations

### Color

Never hard-code Zinc values inside feature components. Use shadcn semantic utilities or Misty semantic tokens so themes remain interchangeable.

| Role | Preferred utility | Token |
| --- | --- | --- |
| App background | `bg-background` | `--misty-semantic-background` |
| Primary surface | `bg-card` or `bg-popover` | `--misty-semantic-surface` |
| Raised or selected surface | `bg-secondary` or `bg-muted` | `--misty-semantic-surface-raised` |
| Hover surface | `bg-accent` | `--misty-semantic-surface-hover` |
| Primary text | `text-foreground` | `--misty-semantic-text` |
| Secondary text | `text-muted-foreground` | `--misty-semantic-text-muted` |
| Subtle metadata | `text-[var(--misty-text-subtle)]` | `--misty-semantic-text-subtle` |
| Standard border | `border-border` | `--misty-semantic-border` |
| Strong border or input | `border-input` | `--misty-semantic-border-strong` |
| Focus | `ring-ring` | `--misty-semantic-focus` |
| Destructive | `text-destructive` | `--misty-semantic-danger` |
| Success | `text-success` | `--misty-semantic-success` |
| Warning | `text-warning` | `--misty-semantic-warning` |
| Information | `text-info` | `--misty-semantic-info` |

Surface hierarchy is tonal first and bordered second:

1. App background
2. Navigation background
3. Primary component surface
4. Raised, selected, or interactive surface

Avoid surrounding every region with a border. Dividers should be subtle, and adjacent areas should often be separated by tone alone.

### Typography

Misty uses Inter Variable for interface and heading text.

| Use | Size | Weight | Notes |
| --- | --- | --- | --- |
| Page title | 24–32px | 600–650 | Use sparingly; most desktop workspaces do not need a large hero title |
| Section title | 16–18px | 600 | Short and direct |
| Control and body text | 14px | 400–500 | Default desktop reading size |
| Supporting text | 12–13px | 400–500 | Descriptions, metadata, timestamps |
| Compact labels | 10–11px | 600–700 | Navigation labels and small category labels |
| Code and paths | 12–14px | 400–500 | Use the system monospace stack |

Guidelines:

- Use sentence case for headings, buttons, menu items, and labels.
- Keep headings concise; descriptions explain consequences or context.
- Use muted text for supporting information, not for essential actions.
- Do not use all caps except for very small technical or categorical labels.
- Avoid ultra-light font weights and decorative tracking.

### Spacing

Use a 4px base rhythm. Preferred gaps and padding are:

- 4px: tightly related icon/text details
- 8px: controls within a group
- 12px: row and compact panel spacing
- 16px: standard section and card spacing
- 20–24px: page sections and dialog interiors
- 32px: large workspace separation

Use `gap-*` on containers instead of scattered child margins. Page horizontal padding should follow `--misty-page-x`. Do not introduce one-off spacing values unless required by a platform or measured layout constraint.

### Shape

The base radius is `0.625rem`.

- Small controls and menu items: `rounded-md`
- Inputs and compact containers: `rounded-md`
- Cards and dialogs: `rounded-xl`
- Large workspace overlays: `rounded-2xl`
- Avatars, status dots, and badges: `rounded-full`

Avoid excessive pill shapes. Pills are reserved for badges, filters, segmented status, and avatars.

### Borders and elevation

- Use one-pixel semantic borders or `ring-1 ring-foreground/10`.
- Standard surfaces use `shadow-xs` or no shadow.
- Menus use `shadow-md` or `shadow-lg`.
- Dialogs and sheets use `shadow-xl`.
- Full workspace overlays may use a deeper shadow and restrained backdrop blur.
- Do not combine a heavy border, heavy shadow, and strong background contrast on the same element.

### Icons

Use Lucide icons.

- 16px: controls, menus, and inline actions
- 20px: prominent toolbar actions
- 24–28px: primary navigation
- 32px or larger: empty states only

Use a consistent stroke width within a surface, generally `1.75` to `2`. Icon-only buttons require an accessible name and usually a tooltip. Do not mix filled illustration styles with Lucide inside functional UI.

## Application Frame

### Desktop

- Native titlebar inset: `--misty-window-titlebar-inset`
- Navigation rail width: `--misty-desktop-nav-width` (`80px`)
- The route workspace occupies the remaining width and height.
- Modal content is centered within the usable route workspace, not the entire window behind the navigation rail.
- Popovers must be clamped below the native titlebar and inside all viewport edges.

The navigation rail is an orientation tool, not a second content panel. Use the theme-aware Misty logo, monochrome navigation icons, concise labels, and the user’s profile image when available.

### Tablet

Desktop and tablet share the same component tree. Respect safe-area tokens and touch targets. Do not create a phone-specific compressed version of a desktop workspace; phone-sized devices are outside the supported layout.

### Workspace composition

Prefer this structure:

1. App frame
2. Optional local sidebar
3. Toolbar or page header
4. Primary content region
5. Optional inspector or contextual panel
6. Status bar or transient feedback

Use resizable panels for persistent peer regions. Use sheets for temporary side tasks and dialogs for decisions that interrupt the current task.

## Components

Use primitives exported from `@/ui`. Do not recreate buttons, inputs, dialogs, menus, tooltips, or selection controls with raw interactive elements.

### Buttons

| Variant | Use |
| --- | --- |
| `default` | Primary action in the current context |
| `secondary` | Visible supporting action |
| `outline` | Neutral action that needs a defined boundary |
| `ghost` | Toolbar, row, and low-emphasis actions |
| `destructive` | Irreversible or damaging actions |
| `link` | Inline navigation, not general controls |

Rules:

- A region should usually have one primary button.
- Use `h-9` default controls, `h-8` compact controls, and `h-10` touch-prominent controls.
- Pair icons with labels unless the icon is universally understood and has a tooltip.
- Disabled controls must remain legible and explain why when the reason is not obvious.

### Inputs and forms

- Inputs default to `h-9`, `rounded-md`, and `border-input`.
- Labels sit above fields and remain visible; placeholders are examples, not labels.
- Group related fields with 12–16px gaps.
- Put validation next to the affected field.
- Use destructive styling only after an error is known.
- Preserve focus rings; never replace them with color alone.

### Cards

Cards group a real unit of content or action. They are not the default page wrapper.

- Use one primary surface with subtle elevation.
- Avoid nested cards.
- Prefer dividers or section headings inside a larger panel.
- Use `Card size="sm"` for dense sidebars and compact settings groups.

### Lists and tables

- Use rows for repeated content, not individual floating cards.
- Keep row actions aligned on the trailing edge.
- Reveal secondary actions on hover or focus when discoverability is not critical.
- Selected rows use a tonal fill; hover should remain visible on top of selection.
- Right-align numeric values and keep column alignment stable.
- Empty states belong inside the list region and should not shift surrounding layout.

### Navigation

- The primary rail communicates destinations.
- Tabs switch peer views within a destination.
- Breadcrumbs communicate hierarchy and allow upward navigation.
- Sidebars organize local objects or sections.
- Do not use tabs, segmented controls, and a local sidebar for the same hierarchy.

Active navigation uses tonal emphasis and stronger text, not a bright brand color.

### Menus and popovers

- Anchor menus to the control that opened them.
- Keep common menus between 160px and 320px wide.
- Use 32–40px menu rows.
- Group related actions with subtle separators.
- Put destructive actions last and style them semantically.
- Use collision-aware Radix primitives whenever possible.
- Custom popovers must measure their rendered size, respond to resize, and remain inside the usable viewport.

### Dialogs and overlays

- Dialogs are for focused decisions or short forms.
- Sheets are for temporary side workflows that benefit from retained context.
- Full workspace overlays are for substantial destinations such as Activity or Settings.
- Center overlays inside the workspace beside the navigation rail.
- Keep at least 16px of viewport clearance, or 32px for large workspace overlays.
- Constrain height and make the content region scroll instead of clipping actions.
- Escape and backdrop click should close non-destructive overlays.
- Destructive confirmations require an explicit labeled action.

### Feedback and states

Use shared loading, empty, permission, and error-state components.

- Loading: preserve layout with skeletons when the structure is known.
- Empty: explain what belongs here and offer one useful next action.
- Error: say what failed and provide recovery when possible.
- Permission: explain the missing access without implying the user is logged out.
- Toast/status: acknowledge background work without blocking the workspace.

Do not use a full-page error for a recoverable error in one panel.

### Avatars and identity

- Display the user-provided profile image when available.
- Fall back to initials derived from the account name or email.
- Use 24px in compact lists, 32px by default, and 40–48px for prominent identity controls.
- Refresh avatar URLs when account data or avatar version changes.

## Interaction

### Motion

Motion should clarify state changes.

- Fast component transition: `--misty-transition-fast` (`160ms`)
- Page or substantial panel transition: `--misty-transition-page` (`320ms`)
- Use opacity, small translation, or restrained scale.
- Avoid springy motion, large travel, and decorative looping animation.
- Respect reduced-motion preferences.

### Focus and keyboard

- Every interactive element must be reachable by keyboard.
- Focus uses the shared ring token and remains visible on all surfaces.
- Dialogs trap focus and restore it to their trigger.
- Arrow keys should work in menus, tabs, radio groups, and command lists through Radix behavior.
- Escape closes the topmost dismissible layer.

### Pointer and touch

- Desktop controls may be 32–36px high.
- Touch-prominent controls should be at least 40px.
- Hover is enhancement, not the only way to discover an essential action.
- Drag targets need a visible affordance and a keyboard-accessible alternative where practical.

## Content Style

- Write direct labels: “Create Space,” not “Create a new Space now.”
- Prefer verbs for actions and nouns for destinations.
- Use “you” sparingly and naturally.
- Error messages should state the problem before technical detail.
- Avoid cute system copy during failures or security-sensitive actions.
- Use “Misty” only when product context is needed; do not repeat the brand in every label.

## Brand Usage

- Use the current monochrome Misty mark.
- Use the white logo on dark or image-backed surfaces and the black logo on light surfaces.
- Preserve the logo’s aspect ratio and clear space.
- Do not place the logo inside an additional tile unless the surface requires a defined hit target.
- Do not use legacy Misty marks, the old cloud-folder identity, or retired bot/mascot visuals.

## Implementation Pattern

Use semantic components and tokens:

```tsx
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui";

export function ExamplePanel() {
  return (
    <Card size="sm" className="max-w-md">
      <CardHeader>
        <CardTitle>Connection</CardTitle>
        <CardDescription>Manage the service used by this workspace.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-end gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Connect</Button>
      </CardContent>
    </Card>
  );
}
```

Avoid hard-coded styling:

```tsx
// Avoid: bypasses themes, shared interaction states, and accessibility defaults.
<button className="rounded-[11px] bg-[#27272a] px-[13px] text-[#fafafa]">
  Connect
</button>
```

## Review Checklist

Before merging a UI change, confirm:

- The screen uses `@/ui` primitives for interactive controls.
- Color comes from semantic utilities or Misty tokens.
- The hierarchy still works in both dark and light modes.
- Spacing follows the 4px rhythm.
- There is one clear primary action per region.
- Hover, focus, active, disabled, loading, empty, and error states are covered.
- Text truncates or wraps intentionally.
- Popovers and dialogs fit inside smaller supported windows.
- Overlays are centered in the usable workspace.
- Icon-only controls have accessible names and tooltips.
- The feature works with keyboard navigation and reduced motion.
- The current theme-aware Misty logo and user avatar behavior are preserved.

## Sources of Truth

- shadcn configuration: `components.json`
- Global tokens and themes: `src/ui/styles/styles.css`
- Global platform behavior: `src/ui/styles/base.css`
- Shared primitives: `src/ui/`
- Desktop frame and overlay geometry: `src/layouts/DesktopLayout/`

When this document and the implementation disagree, resolve the mismatch deliberately: update the component or token first, then update this document in the same change.
