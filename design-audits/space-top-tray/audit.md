# Space top tray audit

## Scope

One-state information-architecture review of the Space workspace header supplied on 2026-08-08.

## User goal

Understand what is open, switch between open work, and find the next relevant action without
confusing Space-scoped tools with app-wide destinations.

## Step 1 — Open workspace tray

Health: needs restructuring.

The left side communicates open tabs reasonably well, but the right side repeats every possible
workspace destination as an unlabeled icon launcher. The adjacent plus menu already serves the same
creation/opening job, so the tray currently mixes three concepts: open tabs, adding tabs, and global
navigation.

## Recommendation

- Keep the top tray for open tabs, New tab, and actions that change the active tab.
- Move Files, Agents, and Code to the global navigation rail because they are useful outside a Space.
- Keep Spaces represented by the Space avatar rail rather than adding another Space launcher.
- Put Extensions under Settings or an app menu; it is management, not a daily destination.
- Put Transfers with Activity or Files as a status surface; it is transient system state, not a
  permanent destination.
- Replace the six right-side launch icons with at most contextual controls such as layout/split and
  an overflow menu. If there are no contextual actions, leave the right side empty.

## Accessibility and evidence limits

The icon-only group has weak visible differentiation and relies on icon recognition. Tooltips,
keyboard behavior, focus order, and screen-reader output cannot be confirmed from the screenshot
alone.
