# Misty UI design system

Misty uses `src/components/ui` as the reusable component system so product pages share the same primitive behavior and can inherit user theming cleanly.

## Preset identity

Misty's canonical component preset is the same one used by `misty-website` and the approved reference:

- shadcn style: `radix-vega`
- base and chart palette: Zinc
- body and heading typeface: Inter Variable
- icons: Lucide (brand marks may use their official icon)
- radius: medium (`--radius: 0.625rem`)
- menu treatment: default translucent with subtle accents

`components.json` records this identity. `src/styles.css` owns the runtime token mapping for Misty's dark, light, and optional custom themes; page code must not recreate the preset locally. Font-family overrides are intentionally unsupported so every native surface remains visually consistent.

## Component ownership

1. `src/components/ui` contains the shadcn/Radix primitives and small generic compositions such as icon buttons, state views, status badges, and toolbars. This is the styling authority.
2. `src/pages/*/components` contains feature-specific composition and behavior. A feature component may combine shadcn/ui components, but it should not introduce another general-purpose button, dialog, menu, toolbar, status, or form system.

Use a shadcn component before importing Radix directly. Import Radix directly only when implementing a new low-level primitive that does not exist in `src/components/ui`.

`npm run check:ui` enforces this boundary for the shared ui layer and the migrated Account, Agents, Home, Providers, Settings, Spaces, Studio, and Transfers pages. It also rejects raw form controls and hand-built fullscreen overlays in those protected areas; the command runs as part of `npm run check`.

## Styling contract

- Use semantic Tailwind colors (`background`, `foreground`, `card`, `muted`, `accent`, `border`, `primary`, `destructive`) in component and page code.
- Misty theme variables feed those semantic tokens in `src/styles.css`. Feature code should not recreate theme mapping.
- Reserve explicit colors for domain meaning such as success, warning, destructive, online, or transfer state.
- Content surfaces are opaque. Wallpaper and translucency belong to the desktop frame, titlebar, gutters, and anchored menus—not to controls or reading surfaces.
- Default radius is `rounded-md`; true cards and modal surfaces use `rounded-xl`. Avoid mixing several radius scales in one view.
- Default controls are 36px high, compact controls are 32px, and touch-oriented controls are 40px. Icon-only buttons must have an accessible label.
- Give a screen or discrete object one quiet boundary at most. Use the Vega card treatment (`bg-card`, `shadow-xs`, `ring-1 ring-foreground/10`) for that boundary.
- Inside a bounded surface, group content with whitespace, `bg-muted/20`–`bg-muted/50`, or `border-border/60` dividers. Do not place every stat, row, input group, or subsection in another outlined card.
- Shadows communicate elevation, not decoration. Most content has no shadow; cards use `shadow-xs`, menus use `shadow-md`, and dialogs/sheets use `shadow-xl`.
- Prefer ghost and secondary controls for routine actions. Reserve the solid primary button for the main action in the current context.

## Page anatomy

Use this structure for standard product pages:

```tsx
<div className="flex h-full min-h-0 flex-col bg-background text-foreground">
  <header className="border-b border-border/60 bg-background">
    <div className="flex min-h-14 items-center gap-3 px-6">
      <h1 className="text-base font-semibold">Page title</h1>
      <Button>Primary action</Button>
    </div>
  </header>
  <main className="min-h-0 flex-1 overflow-auto p-6">...</main>
</div>
```

- The header is the stable page landmark and action area.
- `Toolbar` from `src/components/ui/toolbar` contains search, filters, sorting, and view controls. It does not replace the page header.
- Use `Card` only when the content is truly a discrete object or needs its own boundary.
- Use `EmptyState`, `LoadingState`, `ErrorState`, and `PermissionState` from `src/components/ui/state-view` instead of inventing page-local status panels.

## Interaction patterns

- Actions for one object: `DropdownMenu`.
- Right-click actions: `ContextMenu`.
- Small anchored controls or filters: `Popover`.
- Searchable choices and command palettes: `Command`, usually inside `Popover` or `Dialog`.
- Focused creation or confirmation: `Dialog`.
- Irreversible confirmation: `AlertDialog`.
- Editing that benefits from keeping source context visible: `Sheet`.
- Switching peer views: `Tabs` or a labeled navigation list, depending on whether the URL changes.
- Long content inside overlays: `ScrollArea`.

All overlays must support keyboard traversal, Escape dismissal when safe, visible focus, and focus restoration. Do not build fixed-position overlays in feature code.

## Layout rules

- Preserve established workspace layouts when they carry product behavior. File Explorer keeps its nested split panes, virtualized browser, inspector, drag and drop, and tab persistence.
- Spaces keeps its contextual two-column shell. Primary destinations use the compact horizontal icon rail with accessible labels and tooltips; a page may add at most one contextual inner rail.
- Avoid nested navigation rails that repeat the same destinations.
- At narrow widths, reduce secondary metadata and move non-primary actions into menus before collapsing core content.

## Adding a component

Before adding a new component:

1. Check `src/components/ui` for the low-level behavior.
2. Decide whether the component is a generic ui primitive/composition or belongs beside one page.
3. Use semantic tokens and an existing size/radius contract.
4. Add keyboard and state coverage for interactive behavior.

Use the shadcn CLI with `--dry-run` or `--diff` first. Never blanket-overwrite `src/components/ui`, because these components are application-owned source.
