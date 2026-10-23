# Interface

Misty's look is black, white and gray. Color is the exception, and each exception below is
scoped to one surface and listed here so it does not spread. Feature-specific interface rules
live in that feature's folder: [agents](../agents/README.md), [browser](../browser/README.md), [spaces](../spaces/README.md),
[settings](../settings/README.md), [voice-memory](../voice-memory/README.md).

## Rules

- Shared dropdown and context-menu selections use checkmarks, never dot indicators. Collection toolbars must not add a filter menu that duplicates their visible section tabs.

- Use the approved black, white and gray palette. Do not introduce green, sage, colored status dots, tinted selections or accent-colored focus rings unless the user explicitly requests color for that surface. Convey status through text and icons as well as contrast.

- Exception: item-type icon glyphs on content surfaces (the file explorer, and collection rows and cards on Spaces and other collection pages) use the shared tones in `src/shared/ui/icons/itemTones.ts`. Color the glyph only; icon tiles, hover, selection, focus and status stay monochrome. Tones mark what an item is, never its state. The tab strip, all sidebars (including the Extensions rail) and browser chrome stay uncolored. Add new kinds to the shared map rather than picking colors locally.

- Exception: tab groups use their chosen color: the filled label chip, the outlines of the group's tabs and the editor's swatches. Hover, focus and the rest of the tab strip stay monochrome, and a selected swatch shows a checkmark.

- Exception: official brand logos for connected apps (Integrations rows and tiles, and the app chips under the Agents composer), for coding tools in the composer's Code menu (via `CodingToolIcon`) and for source browsers in the browser import flow (onboarding, Settings and the Bookmarks page) keep their original artwork via `BrandIcon` from `src/shared/ui/icons/brand-icons`. Never recolor them or hand-draw a substitute; apps without artwork fall back to a monochrome Lucide icon. Status around them stays text and icons.

- Exception: the night light (Settings › Appearance › Night light, `src/features/settings/store/nightLight.ts`) lays one warm multiply tint over the whole window and every browser page while it is on. It is off by default, the only setting that schedules anything visual, and the only place that warmth may appear. The theme itself stays Dark, Light or System.

- Tabs always sit in the tab sidebar, on the left or the right of the window (`src/features/app-shell/dockingLayout.ts`). There is no horizontal tab strip: do not add top or bottom tab positions, per-pane toolbar rows or layout code that branches on tab orientation. Layouts saved with tabs on the top or bottom open with tabs on the left. Focus mode hides the sidebar and the Space bar; a browser page then shows its own toolbar row.

- Nested rows (a thread under its agent, anything new) hang off their parent with the shared `TreeBranch` from `@/shared/ui` (`NavigationTree`), the thin muted trunk with ticks and a small rounded last corner from the old navbar's app tree. Don't draw indent lines or borders locally. Vertical tab groups use it too, in the group's color.

- Never show "Loading…" or "Preparing …" text. First loads render animated skeletons shaped like the content that replaces them (`Skeleton`, `SkeletonList`, `SkeletonDocument`, `CollectionSkeleton` from `@/shared/ui`). Background revalidation keeps the current content on screen; never blank a surface or drop to a skeleton while it runs. A Refresh the person presses (a refresh button) is the exception: the content shows skeletons shaped like it until the reload finishes.

## Where color is allowed, by feature

| Surface | Color | Rule lives in |
| --- | --- | --- |
| Item-type icon glyphs | Shared tones (`itemTones.ts`) | this page |
| Tab groups | The group's chosen color | this page |
| Each Space's window chrome | The Space's color | [spaces](../spaces/README.md) |
| Connected-app, coding-tool and browser logos | Original artwork | this page |
| Agent status dots and status tables | `--misty-status-*` | [agents](../agents/README.md) |
| Diffs | Green and red lines | [agents](../agents/README.md) |
| Night light | One warm tint | this page |
