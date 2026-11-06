# Interface

Misty's look is black, white and gray. Color is the exception, and each exception below is
scoped to one surface and listed here so it does not spread. Feature-specific interface rules
live in that feature's folder: [agents](../agents/README.md), [browser](../browser/README.md), [spaces](../spaces/README.md),
[settings](../settings/README.md), [voice-memory](../voice-memory/README.md).

## Rules

- Type is one system face (`font-sans`) and, for code, URLs and codes only, one monospace face (`font-mono`), both defined once in `src/styles/theme.css`. No decorative or serif faces. Sizes come from the scale there (`text-3xs` 10, `2xs` 11, `xs` 12, `ui` 13 for controls, `sm` 14, `md` 15 for page text, `base` 16, `lg` 18 and up); never `text-[Npx]`. Copy is sentence case: no `uppercase`, small caps or ALL-CAPS labels, only real acronyms (URL, PDF, AI).

- Errors are notifications, never inline text. Show a failure with `ErrorNotification` or `Notification tone="error"` from `src/shared/ui/feedback/Notification.tsx` (a retry goes in as a button inside it), not as a paragraph under a field, a banner or a row. The only exceptions are the full-view `ErrorState` for a page that could not load and the crash screen.

- Shared dropdown and context-menu selections use checkmarks, never dot indicators. Collection toolbars must not add a filter menu that duplicates their visible section tabs.

- Use the approved black, white and gray palette. Do not introduce green, sage, colored status dots, tinted selections or accent-colored focus rings unless the user explicitly requests color for that surface. Convey status through text and icons as well as contrast.

- Exception: item-type icon glyphs on content surfaces (the file explorer, and collection rows and cards on Spaces and other collection pages) use the shared tones in `src/shared/ui/icons/itemTones.ts`. Color the glyph only; icon tiles, hover, selection, focus and status stay monochrome. Tones mark what an item is, never its state. The tab strip, all sidebars (including the Extensions rail) and browser chrome stay uncolored. Add new kinds to the shared map rather than picking colors locally.

- Exception: tab groups use their chosen color: the filled label chip, the outlines of the group's tabs and the editor's swatches. Hover, focus and the rest of the tab strip stay monochrome, and a selected swatch shows a checkmark.

- Exception: official brand logos for connected apps (Integrations rows and tiles, and the app chips under the Agents composer) and for source browsers in the browser import flow (onboarding, Settings and the Bookmarks page) keep their original artwork via `BrandIcon` from `src/shared/ui/icons/brand-icons`. Never recolor them or hand-draw a substitute; apps without artwork fall back to a monochrome Lucide icon. Status around them stays text and icons.

- Exception: the night light (Settings › Interface › Night light, `src/features/settings/store/nightLight.ts`) lays one warm multiply tint over the whole window and every browser page while it is on. It is off by default, the only setting that schedules anything visual, and the only place that warmth may appear. The theme itself stays Dark, Light or System.

- A button that goes back to the previous page or step is `BackButton`: the arrow and the word "Back", as one button. Browser and picker history (back beside forward) and previous/next steppers stay icons.
- Tabs always sit in the tab sidebar, on the left or the right of the window (`src/features/app-shell/dockingLayout.ts`). There is no horizontal tab strip: do not add top or bottom tab positions, per-pane toolbar rows or layout code that branches on tab orientation. Layouts saved with tabs on the top or bottom open with tabs on the left. The window buttons sit on the sidebar's header with tabs on the left. With tabs on the right they sit at the left of the Space bar, which keeps room for them, and fade out and back with it, so they never lie over a page. Focus mode hides the sidebar and the Space bar; a browser page then shows its own toolbar row. The sidebar header, the Space bar and the window buttons share one centerline, 24px from the window's top, on either side. Their controls are 28px with 18px glyphs at the toolbar stroke, 6px apart; only thin glyphs (arrows, chevrons) draw at 20px.

- Nested rows (a thread under its agent, anything new) hang off their parent with the shared `TreeBranch` from `@/shared/ui` (`NavigationTree`), the thin muted trunk with ticks and a small rounded last corner from the old navbar's app tree. Don't draw indent lines or borders locally. Vertical tab groups use it too, in the group's color.

- Never show "Loading…" or "Preparing …" text. First loads render animated skeletons shaped like the content that replaces them (`Skeleton`, `SkeletonList`, `SkeletonDocument`, `CollectionSkeleton` from `@/shared/ui`). Background revalidation keeps the current content on screen; never blank a surface or drop to a skeleton while it runs. A Refresh the person presses (a refresh button) is the exception: the content shows skeletons shaped like it until the reload finishes.

## Where color is allowed, by feature

| Surface | Color | Rule lives in |
| --- | --- | --- |
| Item-type icon glyphs | Shared tones (`itemTones.ts`) | this page |
| Tab groups | The group's chosen color | this page |
| Each profile's window chrome | The profile's color | [sync](../sync/README.md) |
| Connected-app and browser logos | Original artwork | this page |
| Agent status dots and status tables | `--misty-status-*` | [agents](../agents/README.md) |
| Night light | One warm tint | this page |
