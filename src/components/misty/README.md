# Misty component layer

This directory contains product-level UI patterns. Components here compose the
low-level shadcn primitives in `src/components/ui`; they do not own feature data,
routing, or API calls.

Use the layers consistently:

1. `components/ui` for accessible primitives such as Button, Dialog, Select, and
   Tabs.
2. `components/misty` for repeated Misty patterns such as page anatomy,
   toolbars, side navigation, status badges, and application states.
3. `pages/<feature>/components` for components that know about a feature's
   domain objects or routes.

Design invariants:

- The canonical preset is shadcn `radix-vega` with Zinc tokens, medium radius,
  Outfit body text, Inter headings, and Lucide icons.
- Use semantic utilities (`bg-background`, `bg-card`, `border-border`,
  `text-foreground`, and `text-muted-foreground`) instead of literal colors.
- Keep content surfaces opaque. Wallpaper translucency belongs to frame and
  global chrome variables only.
- Standard controls are 36px high, compact controls are 32px, and touch or large
  controls are 40px.
- Standard controls use the medium preset radius; true cards and large dialogs
  use `rounded-xl`.
- Draw one quiet boundary around a true surface. Inside it, prefer muted tonal
  fills, whitespace, or `border-border/60` dividers over nested outlined cards.
- Use `shadow-xs` for cards, `shadow-md` for menus, and `shadow-xl` only for
  dialogs and sheets. Routine nested content should not cast a shadow.
- Use `EmptyState`, `ErrorState`, `PermissionState`, and `LoadingState` instead of
  inventing a new page-state treatment.
- Preserve feature layout behavior. In particular, File Explorer's multipanel
  workspace is not replaced by the generic shadcn Sidebar or Table patterns.

Import the public API from the barrel:

```tsx
import {
  PageBody,
  PageHeader,
  PageShell,
  Toolbar,
  ToolbarGroup,
} from "@/components/misty"
```
