---
target: current Global Navigator sidebar screenshot
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-28T07-27-03Z
slug: lication-layouts-desktoplayout-globalnavigator-tsx
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2/4 | The visible selection can disagree with `aria-current`, so sighted and screen-reader users may be told different locations. |
| 2 | Match system / real world | 2/4 | “Misty” reads as product, Space, and assistant; “Apps” hides shared versus private context. |
| 3 | User control and freedom | 2/4 | Hidden mode can leave an off-screen navigator keyboard-accessible; Planner and Files also split open/expand behavior. |
| 4 | Consistency and standards | 2/4 | Crisp line icons are interrupted by a tiny raster companion; intended faint text falls back to bright cream. |
| 5 | Error prevention | 2/4 | Nothing warns users which destinations are Space-shared and which remain private. |
| 6 | Recognition rather than recall | 2/4 | Users must remember scope rules and infer what the companion icon does. |
| 7 | Flexibility and efficiency | 3/4 | Search, a shortcut, direct destinations, remembered routes, and disclosures support experienced users. |
| 8 | Aesthetic and minimalist design | 3/4 | Calm and disciplined, but the flat eight-item Apps list and heavy bottom island weaken hierarchy. |
| 9 | Error recovery | 1/4 | Disabled Space tools say “Waiting for Spaces” only on hover and expose no visible retry path. |
| 10 | Help and documentation | 1/4 | Product-specific concepts—Space scope, privacy, and the companion—have no visible contextual explanation. |
| **Total** |  | **20/40** | **Acceptable, but significant work remains.** |

## Design Specificity Verdict

**Category-polished, product-underarticulated.** The charcoal palette, restrained states, stable icon slots, and compact density are coherent and credible. But this could be another dark productivity sidebar after relabeling. Misty’s defining promise—collaborative Space context alongside private execution tools—is invisible.

The deterministic scan returned **0 findings**. That clean result is narrow: the independent implementation pass still found two P1 behavioral/accessibility defects, an undefined visual token, weak disabled-state communication, and undersized shared tablet controls. No reliable visual overlay is available because the browser surface did not support mutable script injection; the supplied authenticated screenshot plus source and live measurements were used instead.

## Overall Impression

The sidebar looks calm, competent, and close to polished. Its biggest failure is not cosmetic: it does not tell users what context they are operating in or what remains private. The visual shell is ahead of the information architecture and accessibility semantics.

## What’s Working

- The selected row is excellent: cream text, a single tonal fill, and a narrow sage marker communicate state without shouting.
- Row craft is disciplined: stable icon slots, predictable truncation, restrained rounding, and consistent scanning rhythm.
- The shell structure is sound: Space switching stays pinned above a separately scrolling destination list, while account controls remain reachable below.

## Priority Issues

### P1 — The rail hides Misty’s shared/private boundary

`Chat`, `Journal`, `Planner`, and `Library` are tied to the current Space, while `Browser`, `Files`, `Code`, and `Terminal` are private by default. Presenting all eight as equivalent “Apps” invites incorrect sharing assumptions.

**Fix:** Use explicit conceptual groups: Global (Home, Inbox, Agents); Current Space — Misty (Chat, Journal, Planner, Library); Personal · Private (Browser, Files, Code, Terminal). Keep less-frequent destinations in the launcher and add a quiet private cue.

**Suggested command:** `$impeccable shape`

### P1 — Visual selection and assistive semantics can disagree

In the live implementation, `/home` exposed Home as `aria-current="page"` while Inbox was visually selected from workspace state. Two users can receive contradictory answers to “Where am I?”

**Fix:** Make one state source authoritative. Apply selected styling and `aria-current` from the focused workspace surface, or synchronize the route before rendering. Add a regression test that asserts the same destination owns both.

**Suggested command:** `$impeccable audit`

### P1 — Hidden mode leaves an off-screen navigator operable

The implementation can render two Primary navigators off-screen; one remains without `aria-hidden` or `inert`. Keyboard and screen-reader users can tab through invisible controls.

**Fix:** Apply `inert` and `aria-hidden="true"` to every concealed navigator copy, remove it from tab order, and restore it only when revealed. Add keyboard-order tests for full, hidden, and revealed states.

**Suggested command:** `$impeccable harden`

### P2 — “Misty” represents three different objects

The top control can read as brand or account, the assistant is an unexplained image, and the default Space shares the same name. The raw “Misty Space” browser tooltip confirms the ambiguity without solving it.

**Fix:** Show `Misty · Space` or a compact Space descriptor; use a rounded-square Space avatar while keeping people circular; call the assistant “Ask Misty”; replace the native title tooltip with the product tooltip component; and replace or redraw the fuzzy 20px raster companion.

**Suggested command:** `$impeccable clarify`

### P2 — The visual and accessibility tokens are not production-ready

`text-cream-faint` is not defined, focus contrast is weak, disabled rows use opacity alone, status badges may be masked by the parent accessible name, and 32–40px controls are too small for the shared tablet layout.

**Fix:** Replace or define the faint token; use a ≥3:1 focus indicator; include agent and unread state in accessible names; provide persistent loading and retry UI; and raise shared tablet targets to roughly 44px.

**Suggested command:** `$impeccable audit`

## Persona Red Flags

**Alex, power user:** Eleven permanent destinations slow repeated scanning; the Search shortcut is only discoverable by hover; Planner and Files divide “open” and “expand” into separate hit areas. Direct-open behavior and remembered routes are strong.

**Jordan, first-timer:** “Misty” does not reveal whether it is a product, Space, account, or assistant. “Apps” offers no conceptual help. Nothing explains Library versus Files or shared versus private behavior. The companion image is unfamiliar and icon-only.

**Sam, accessibility-dependent:** Hidden navigation remains focusable; focus contrast is weak; visible selection can contradict `aria-current`; disabled-state reasons are hover-dependent; agent and unread statuses may not be announced; collapsed mode would become tooltip-dependent.

## Minor Observations

- Quiet the Space switcher hover by one tonal step; it currently outweighs the selected destination.
- Reduce the account dock’s shadow/border emphasis so secondary chrome does not compete with the active row.
- Preserve the empty working space, but make the top and bottom anchors feel like one rail rather than two floating islands.
- Add an overflow cue when Planner or Files expansion makes the hidden-scrollbar list longer than the viewport.
- Unify Planner and Files disclosure behavior into one predictable tree interaction.
- Wire and test collapsed mode or remove the unreachable branches.
- Remove the unused `mistyLogoSource` prop if that branding path is abandoned.
- Add tests for hidden-mode focusability, active-style/`aria-current` agreement, status-aware accessible names, and tablet target sizing.

## Questions to Consider

- Should this rail primarily express the current collaboration context or act as a permanent catalog of apps?
- If Browser is opened while the user is “inside” a Space, what should reassure them beforehand that it remains private?
- Are the product, assistant, and default Space intentionally all named Misty? If so, what visual grammar makes them related without making them interchangeable?
- Which four destinations truly deserve permanent placement, and which belong in Search?
