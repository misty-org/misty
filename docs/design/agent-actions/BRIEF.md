# What an agent can do on a page

Draft for approval, October 19. An agent in its own window should be able to do anything a
person does with a mouse and keyboard, and the person watching should see each action happen.
Today it mostly reads: on the Depop task it made 39 navigations and 18 extracts, and no clicks.
It moves around by typing URLs instead of using the page.

## Principles

- **Real input, where the page can tell.** Hover, wheel scrolling and typing go through native
  events into the page's own view, as `MistyBrowserInput.m` already does for clicks. Scripted
  DOM events don't trigger CSS `:hover`, wheel-driven loading or keystroke autocomplete.
  Scripts stay the fallback for frames and pages where native input can't land.
- **Every pointer action is visible.** The cursor (`browser_agent_cursor.js`) glides to the
  target before every action, not only clicks: hover, scroll, drag, focus before typing,
  select. Typing shows a caret highlight on the field.
- **Element first, point second.** Actions name a ref from the latest snapshot. A point
  (normalized 0–1) is for canvases, maps and controls with no ref, as `browser_act` does now.
- **One tool, many actions.** `browser_steps` stays the one structured tool, and a whole
  sequence still runs in one call. New actions are added to it, not as new tools.
- **The gates stay.** Paying, sending, deleting, posting and signing up still stop where they
  stop today, whatever action reaches them.

## Today

| Area | What exists | Gap |
|---|---|---|
| Click | Left or right, single or double; native at the control's point | No triple-click, middle-click, modifier-click (⌘-click to a new tab, shift-click a range), long press |
| Hover | Synthetic pointer and mouse events | CSS `:hover` menus never open; no cursor shown |
| Scroll | Script `scrollBy` up, down, left or right by screens; `into_view` | No wheel at a point inside a panel; no scrollbar dragging; nothing for wheel-driven pages; no cursor |
| Type | `fill` sets the value and fires input and change; Enter after it | No key-by-key typing for autocomplete, search-as-you-type or editors; no caret placement |
| Keys | One key or shortcut with modifiers | No held modifier across clicks; no Tab focus walk |
| Forms | fill, select, check and uncheck, `fill_form`, upload | No sliders or ranges, date pickers by hand, color inputs, rich-text editors beyond fill |
| Drag | Only through `browser_act` (vision, by coordinates) | No ref-to-ref drag (sortable lists, kanban, sliders, maps) in `browser_steps` |
| Text | — | No selecting text, no copy or paste |
| Navigation | `navigate` to a URL, `screen_open` for tabs | No back, forward or reload; no "open this link in a new tab" |
| Page events | Cookie banners declined, closed or hidden on load | No answer to the page's alert, confirm, prompt or leave-page dialogs; no permission prompts (location, notifications); no HTTP sign-in dialog |
| Popups | New windows load in the same tab | Pages that need the opener (OAuth popups) |
| Media | — | Play, pause, seek and mute in a video or audio player |
| Page view | Snapshot, find, extract, visual, markdown | Zoom the page; find-in-page highlight |

## Proposed actions in `browser_steps`

Pointer
- `move` (alias `hover`): the cursor goes to a ref or point and stays, so hover menus open.
  Native mouse-moved events.
- `click`: adds `button: middle`, `clickCount` up to 3, `modifiers` (meta, shift, alt,
  control) and `holdMs` for a long press.
- `drag`: from a ref or point to a ref or point, with `steps` for a visible path. Covers
  sliders, scrollbars, sortable lists, maps and canvases.

Wheel
- `scroll`: adds `at` (a ref or point). It scrolls the panel under it with native wheel
  events in small increments, so lazy loading and scroll-snap carousels respond. `into_view`
  stays, and so does the screen-based amount.

Keyboard
- `type`: key-by-key into the focused field or a ref, at a human pace (`delayMs`, default 40),
  for autocomplete and editors. `fill` stays for setting a value at once.
- `key`: adds held modifiers across the next steps (`down` and `up`) and `Tab` walking.

Text
- `select_text`: select a ref's text or a text match. `copy` puts the selection on the agent's
  own clipboard (never the person's); `paste` pastes it, or given text, into the focused field.

Navigation
- `back`, `forward`, `reload` on the tab.
- `click` with `newTab: true` opens a link in another tab of the agent's own.

Page events (in the page layer, not steps)
- **Dialogs:** a page's `alert` is read and closed; `confirm` and `prompt` are answered the safe
  way (cancel) unless the step that raised them asked for one. The text goes back in the step
  result. A leave-page dialog stays for the agent to decide.
- **Permission prompts:** denied by default in the agent's own window; the person can allow
  one after Take over.
- **HTTP sign-in dialogs:** handed to the person (`browser_request_user_action`).

Media
- `media`: play, pause, seek to a time, mute, on a ref or the page's main player.

## The cursor

- One cursor per agent tab, white with a dark edge. It glides 320 ms to each target (instantly
  under Reduce motion) and pulses where it presses.
- It follows every pointer action: move, click, drag (along the path), scroll (sits where the
  wheel turns), focus before typing.
- It is drawn inside the page and stays out of the agent's snapshots. It's hidden when the
  person takes over.

## Order of work

1. Native `move`, wheel `scroll` at a point, and key-by-key `type`, each with the cursor. These
   cover the hover menus, panels and search fields agents miss today.
2. `drag` in `browser_steps`; `back`, `forward` and `reload`; `newTab` clicks.
3. Dialogs and permission prompts in the page layer.
4. Text selection with copy and paste; `media`; triple and middle clicks, long press, modifiers.
5. The prompt: the Screens guidance describes the vocabulary once. Tool descriptions carry the
   detail.

## Checks

- **Unit:** step validation for each new action, and the cursor following each pointer action.
- **Live, on a page set:**
  - a CSS hover menu (opens);
  - a lazy-loading feed (loads on wheel);
  - a search box with suggestions (suggestions appear);
  - a sortable list and a range slider (moved);
  - a page with `alert` and `confirm` (answered, text reported);
  - back and forward (history moves);
  - the cursor is visible in the window at each step.
- **Odysseys:** the dev batch, with clicks per run as a metric beside the score.
