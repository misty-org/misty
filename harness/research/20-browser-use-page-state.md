# 20 - browser-use: how page state is built for the model

Scope: how browser-use turns a live page into the text (and images) a model reads, and how each piece maps onto a
native-webview host (WKWebView / WebKitGTK through wry) that has no CDP and no Playwright.

Sources read (not run):

- `refs/browser-use` at tag **1.0.5** (commit `e717df1`, MIT). This is the checkout the task pointed at.
- `refs/browser-use-0x/src` at tag **0.13.14** (MIT), the last 0.x release. I shallow-cloned it for reading only,
  because **1.0.5 has no `browser_use/dom/` directory**. 1.0 removed the whole 0.x DOM engine:
  `MIGRATING.md:3` says the agent "no longer picks one action per step from a DOM dump", `MIGRATING.md:106` lists the
  removed DOM tuning knobs (`paint_order_filtering`, `cross_origin_iframes`, `max_iframes`, `viewport_expansion`,
  ...), and `MIGRATING.md:282` says `browser_use.dom` and `browser_use.actor` were removed.

Paths below are relative to each repo root. **[1.0]** means `refs/browser-use`, **[0.x]** means
`refs/browser-use-0x/src`. Anything marked "(inferred)" is my reasoning, not something I read in the code.

The main finding: browser-use has shipped **two different page-state designs**, and both are worth learning from.

1. **0.x "DOM dump" engine** (`browser_use/dom/`, about 6,200 lines). It merges three CDP sources (DOM tree,
   accessibility tree, DOMSnapshot layout), works out what is visible and interactive, removes occluded and redundant
   nodes, and prints an indented pseudo-HTML tree with `[index]` handles. This is the design behind browser-use's
   well-known benchmark results.
2. **1.0 "ultrafast" accessibility-tree printer** (`browser_use/ax.py`, 868 lines, a port of "Browser Use Pi
   ax.ts" per `ax.py:1`). It prints Chrome's full AX tree as a flat list in page order (`[id] role "name" = value
   states`), keeps only text that is actually visible, waits on events instead of fixed sleeps, and reports what
   changed after each action. The model writes Python in a REPL and calls `bu.state()`, `bu.click(id)` and
   `bu.type(id, text)`.

For a native webview, the 1.0 design is much easier to port and is likely the better starting point. The 0.x
heuristics (interactivity scoring, bounding-box propagation, compound controls, format hints, scroll hints) are the
best ideas to borrow from 0.x.

---

## 0. Licensing

| Area | License | Evidence |
|---|---|---|
| browser-use 1.0.5, whole repo, including `browser_use/ax.py` and `browser_use/repl/*.py` | MIT | `LICENSE` ("MIT License, Copyright (c) 2024 Gregor Zunic"). No per-file license headers in `browser_use/` |
| browser-use 0.13.14 `browser_use/dom/**`, `browser/watchdogs/**`, `browser/python_highlights.py`, `agent/prompts.py`, `agent/system_prompts/*.md` | MIT | `LICENSE` at that tag is the same MIT text. `grep -rn "License\|SPDX" browser_use/dom` finds no headers that override it |
| browser-harness (`refs/browser-harness`), the helper layer 1.0 runs on | MIT | `LICENSE` ("Copyright (c) 2026 Browser Use") |

MIT code can be brought into an AGPL-3.0 project as long as we keep the MIT copyright and permission notice (for
example in `NOTICE` and in file headers of the ported code). Every file area recommended below is MIT.

---

## 1. The 0.x pipeline, end to end

### 1.1 Capture: four CDP calls in parallel ([0.x] `browser_use/dom/service.py`)

`DomService._get_all_trees` (`service.py:403-700`) runs the following:

1. **Iframe scroll positions**: an in-page JS walk over `document.querySelectorAll('iframe')` that reads
   `contentDocument.documentElement.scrollTop/Left` (`service.py:416-454`). This is pure JS, and cross-origin frames
   are skipped by `try/catch`.
2. **Click-listener detection**: `Runtime.evaluate` with `includeCommandLineAPI: true`, so the DevTools-only
   `getEventListeners(el)` is available. It walks `querySelectorAll('*')`, gives up above 10,000 elements, collects
   elements that have `click/mousedown/mouseup/pointerdown/pointerup` listeners, and gives up if more than 100 match
   (`_MAX_JS_CLICK_LISTENER_ELEMENTS`, `service.py:34`, `456-567`). The returned objects are mapped to `backendNodeId`
   with `DOM.describeNode` in batches of 20 (`service.py:35`, `549-553`). **CDP: hard**, because `getEventListeners`
   exists only in the DevTools command-line API.
3. **In parallel** (`service.py:569-598`):
   - `DOMSnapshot.captureSnapshot` with `computedStyles = REQUIRED_COMPUTED_STYLES` (display, visibility, opacity,
     overflow, overflow-x, overflow-y, cursor, pointer-events, position, background-color;
     `enhanced_snapshot.py:17-29`), `includePaintOrder: true` and `includeDOMRects: true`.
   - `DOM.getDocument(depth=-1, pierce=True)`. `pierce` returns shadow roots, including closed ones, and same-process
     iframe documents.
   - `Accessibility.getFullAXTree` for **every frame** in `Page.getFrameTree`, merged into one node list. A child
     frame that fails is skipped. A main frame that fails is re-raised (`service.py:357-401`).
   - `Page.getLayoutMetrics` for the device pixel ratio (`service.py:222-249`).
4. **Timeouts and retries**: wait 10 s for all of them, recreate whatever is still pending, wait 2 s more. If the AX
   tree fails, it becomes `{'nodes': []}` and the build continues. If the snapshot or the DOM tree fails, it raises
   (`service.py:597-654`). Documents are capped at `max_iframes` (default 100; `service.py:62`, `667-674`).

### 1.2 Merge: `EnhancedDOMTreeNode`

- `build_snapshot_lookup` (`enhanced_snapshot.py:70-219`) builds a `backendNodeId -> EnhancedSnapshotNode` map:
  `bounds` (divided by DPR to get CSS px, `:153-163`), `clientRects`, `scrollRects`, the computed styles, `paintOrder`,
  `stackingContexts`, the rare boolean `isClickable` (Chrome's own "has a click handler / is a link" flag), and the
  **live** `inputValue/textValue/inputChecked`. Values of password, file and hidden inputs, and of `autocomplete=cc-*`
  and `one-time-code` fields, are never read (`:46-67`, `:118-128`). The views docstring says `bounds` are document
  coordinates that ignore scroll (`views.py:326-337`).
- `_construct_enhanced_node` (`service.py:759-1079`) walks `DOM.getDocument` recursively. It joins the AX node by
  `backendNodeId` (`:746-748`, `:791`) and the snapshot node. It replaces the `value`/`checked` attributes with live
  values (`:814-826`). It computes `absolute_position = bounds + accumulated frame offset` (`:846-853`). Frame offsets
  add each iframe's `bounds.x/y` (`:906-916`) and subtract each `HTML` frame root's `scrollRects` (`:893-904`).
  Shadow roots go into `shadow_roots` and are kept out of `children` (`:925-949`).
- **Cross-origin iframes** (off by default: `cross_origin_iframes=False`, `service.py:60`) are only followed when the
  iframe is visible and at least 10x10 px (`:37-42`, `:976-1008`). The iframe is matched to a CDP target by
  `frameId`, or by **src URL without the query string** for frames injected late (`:1016-1031`), and the whole
  `get_dom_tree` runs again on that target, up to `max_iframe_depth=5` and `max_iframes` (`:1051-1077`).

### 1.3 Visibility ([0.x] `service.py:251-355`)

`is_element_visible_according_to_all_parents` decides visibility as follows:

- Not visible if `display:none`, `visibility:hidden` or `opacity<=0` (from the snapshot's computed styles), or if
  there are no layout bounds.
- **Viewport threshold**: for each enclosing frame (walking the list in reverse), it shifts the bounds by the iframe
  offset and tests intersection with that frame's viewport (`clientRects`), shifted by `scrollRects` and widened by
  **±1000 px vertically** (`viewport_threshold=1000`, `:64`, `:339-344`). So content up to about one screen below the
  fold is listed, and anything further is dropped. Horizontal intersection gets no margin.
- `_count_hidden_elements_in_iframes` (`:80-192`) handles iframes separately. It collects up to 10 interactive
  elements that are only hidden by the threshold (CSS-visible but too far away), with
  `pages = y / iframe_viewport_height`. The serializer prints them as
  `... (N more elements below - scroll to reveal):` followed by `<tag> "text" ~X pages down`
  (`serializer.py:1184-1199`).

Overrides in the serializer: **any element with an `aria-*` or `pseudo*` attribute is forced visible**
(`serializer.py:519-523`). This quirk keeps hidden validation messages in the output. **File inputs** are forced
visible because frameworks hide them with `opacity:0` (`:525-531`, `:579-594`, `:695-702`).

### 1.4 "Is this interactive?" ([0.x] `browser_use/dom/serializer/clickable_elements.py:4-246`)

An ordered list of rules. The first one that matches decides:

1. Only element nodes; never `html` or `body` (`:28-37`).
2. `has_js_click_listener`, from `getEventListeners`, gives true (`:41-42`).
3. `iframe`/`frame` larger than 100x100 gives true, so it can be scrolled (`:46-52`).
4. `label` with `for=` gives **false**, to avoid clicking the target input twice. A `label` or `span` that wraps an
   `input/select/textarea` up to 2 levels down gives true (`:58-73`).
5. Search hints: class, id or `data-*` contains `search, magnify, glass, lookup, find, query, ...` gives true
   (`:75-103`).
6. AX properties: `disabled` or `hidden` true gives **false**. `focusable/editable/settable` true gives true. Having
   any of `checked/expanded/pressed/selected` gives true. `required/autocomplete/keyshortcuts` true gives true
   (`:105-135`).
7. Tags `button, input, select, textarea, a, details, summary, option, optgroup` give true (`:139-152`).
8. Attributes `onclick, onmousedown, onmouseup, onkeydown, onkeyup, tabindex` give true. An HTML `role` in
   {button, link, menuitem, option, radio, checkbox, tab, textbox, combobox, slider, spinbutton, search, searchbox,
   row, cell, gridcell} gives true (`:174-202`).
9. An AX role in the same set plus `listbox` gives true (`:204-226`).
10. **Icon heuristic**: 10-50 px in both dimensions and has any of `class, role, onclick, data-action, aria-label`
    gives true (`:228-240`).
11. Fallback: computed `cursor: pointer` gives true (`:242-244`).

Results are cached per `(session_id, node_id)` (`serializer.py:434-453`).

### 1.5 Serializer passes ([0.x] `browser_use/dom/serializer/serializer.py`)

`serialize_accessible_elements` (`:114-165`) runs these passes in order:

**Pass 1, simplified tree** (`_create_simplified_tree`, `:455-560`):

- Drops `style, script, head, meta, link, title` (`:18`) and SVG children (`path, rect, g, circle, ...`; `:21-39`).
  The `<svg>` itself is kept and printed collapsed (`:1016-1041`).
- Honors an opt-out attribute, `data-browser-use-exclude[-<session>]="true"` (`:488-501`).
- Inlines iframe content documents (`:503-510`). Shadow roots (`DOCUMENT_FRAGMENT_NODE`) are always kept
  (`:467-477`).
- An element is kept if it is visible, scrollable, has children, or is a shadow host (`:533-553`).
- Text nodes are kept only if visible and longer than one character after trimming (`:554-558`).
- **Compound controls** (`_add_compound_components`, `:167-350`) add virtual sub-parts to the line:
  - `range`: min and max.
  - `number`: increment, decrement and a value box.
  - `color`.
  - `file`: current file name from AX `valuetext`/`value`, or `None`.
  - `select`: option count, first 4 options (each cut to 30 chars, `:405-417`), and a format hint (numeric,
    country/state codes, date/path, email; `:419-430`).
  - `details`, `audio`, `video`.
  - Date and time inputs on purpose get **no** compound parts, because "Day, Month, Year" made models type the wrong
    format (`:196-203`).

**Pass 2, paint-order occlusion** (`paint_order.py:146-225`):

- Takes every node with a `paintOrder` and bounds, groups them by `paintOrder`, and visits the groups from the
  highest value down (topmost first).
- Keeps one `RectUnionPure` per document context `(session_id, owning iframe frame_id)` (`:154-163`).
- A node whose rectangle is **fully covered** by the union of rectangles painted above it gets
  `ignored_by_paint_order`.
- A node is added to the union as an occluder only if its `background-color` is not `rgba(0, 0, 0, 0)` and its
  `opacity` is at least 0.8. The code comments call 0.8 "highly vibes based" (`:207-219`).
- `RectUnionPure` keeps a disjoint set of rectangles by splitting each into up to 4 pieces (`:58-83`). It stops
  growing at 5,000 rectangles, after which coverage is conservatively "not covered" (`:48-52`, `:115-117`).

Ignored nodes get no index (`serializer.py:666`). Ignored text is not printed, which hides text under an open modal
(`:1163-1175`).

**Pass 3, prune** (`_optimize_tree`, `:562-596`): keeps nodes that are visible, scrollable, text, file inputs, or
have children.

**Pass 4, bounding-box propagation** (`:772-923`):

- `a`, `button`, `div|span[role=button|combobox]` and `input[role=combobox]` (`PROPAGATING_ELEMENTS`, `:46-57`) pass
  their bounds down to all descendants.
- A descendant that lies at least **99%** inside those bounds (`DEFAULT_CONTAINMENT_THRESHOLD=0.99`, `:58`, `:883-901`)
  gets `excluded_by_parent`, so it gets no index of its own. Its children and text still print.
- Exceptions: form elements and labels, nested propagating elements, `onclick`, a non-empty `aria-label`, and roles
  {button, link, checkbox, radio, tab, menuitem, option} (`:826-881`).
- This is what turns `<a><div><span><img></span></div></a>` into a single `[n]<a>`.

**Pass 5, indices and new-element markers** (`:637-770`):

- Index = **the element's CDP `backendNodeId`** when that is unique in this snapshot. Otherwise a synthetic integer
  is allocated above the largest backend id in use (`_reserve_backend_node_ids`, `_allocate_selector_index`,
  `:637-658`). (Older 0.x releases numbered 1..n in order; 0.13 switched to backend ids so that indexes stay the same
  across steps.)
- Scrollable containers get an index **only if** they are dropdown-like or have no interactive descendants
  (`:715-746`). Dropdown-like means role listbox/menu/combobox/menubar/tree/grid, the `select` tag, or a
  `dropdown`/`dropdown-menu`/`select-menu`/Semantic UI class.
- Shadow-DOM form controls that lack snapshot layout still get an index (`:704-713`).
- `is_new` is set when `(session_id, backend_node_id)` was not in the previous step's selector map (`:76-83`,
  `:759-766`). Compound components are always marked new. The prompt says new markers apply "if url has not changed",
  but the code does not check the URL; after a navigation every element is new because its backend ids are new
  (inferred from `:660-766`).
- The selector map `{index -> EnhancedDOMTreeNode}` is what actions resolve against (`views.py:919`, `:936-940`).

### 1.6 The text format ([0.x] `serializer.py:988-1201`, `1203-1406`)

```
<page_stats>12 links, 31 interactive, 0 iframes, 2 images, 210 total elements</page_stats>
Current tab: 9A3F
Available tabs:
Tab 9A3F: https://... - Title
<page_info>0.0 pages above, 2.3 pages below — scroll down to reveal more content</page_info>
Interactive elements:
[Start of page]
[33]<div />
	User form
	[35]<input type=text placeholder=Enter name />
	*[38]<button aria-label=Submit form />
		Submit
|scroll element|<div /> (0.0 pages above, 3.1 pages below)
|SHADOW(open)|[51]<my-widget />
	Open Shadow
		...
	Shadow End
|IFRAME|<iframe />
	... (3 more elements below - scroll to reveal):
	    <button> "Accept" ~1.4 pages down
```

Details:

- Tab indentation shows DOM nesting. Only interactive, scrollable or iframe elements get a tag line. Text nodes print
  bare, one per line. Elements that are neither are "transparent": their children print at the same depth
  (`:1043-1052`).
- Attributes come from a fixed allow-list in a fixed order (`DEFAULT_INCLUDE_ATTRIBUTES`, `views.py:18-82`): `title,
  type, checked, id, name, role, value, placeholder, alt, aria-label, aria-expanded, data-state, aria-checked,
  aria-value*, pattern, min, max, minlength, maxlength, step, accept, multiple, inputmode, autocomplete, list,
  data-mask, contenteditable, ...`, plus AX properties (`checked, selected, expanded, pressed, disabled, invalid,
  valuenow, haspopup, required, valuetext, level, busy, live`). `class` is deliberately left out.
- Clean-up rules (`:1346-1392`):
  - Drop a duplicate value longer than 5 chars, unless it is protected: `format, placeholder, value, aria-label,
    title`.
  - Drop `role` if it equals the tag, and `type` if it equals the tag.
  - Drop `invalid=false` and false `required`.
  - Prefer AX `expanded` over `aria-expanded`.
  - Every value is cut to 100 chars (`:1398`).
- **Format hints**: `format=YYYY-MM-DD` and the like for native date/time inputs, a `123-456-7890` placeholder for
  `tel`, and jQuery/Bootstrap/AngularJS datepicker detection that reads `uib-datepicker-popup` and
  `data-date-format`, defaulting to `mm/dd/yyyy` (`:1218-1292`).
- **Live values**: AX `valuetext`, then `value`, overrides the HTML attribute. **Password values are never printed**
  (`:1294-1341`).
- **Image context** for interactive elements: `image_alt/title/label/src` (just the file name; no `data:` URLs) from
  at most 3 images among the first 100 descendants (`:925-986`). This is how icon-only buttons get a meaningful
  label.
- Scroll info comes from `scrollRects` and `clientRects` (`views.py:627-828`). An element counts as scrollable if CDP
  says `isScrollable`, or if its scroll size exceeds its client size by more than 1 px **and** its overflow is
  `auto/scroll/overlay`. Scroll info is not repeated inside a parent that already scrolls (`views.py:678-704`).

### 1.7 Compaction and page-level hints ([0.x] `browser_use/agent/prompts.py`)

- Element text is **cut at 40,000 characters** with a head-only cut (`max_clickable_elements_length=40000`,
  `prompts.py:117`, `:254-258`). There is no middle-out cut.
- `<page_stats>` (`:150-250`):
  - Fewer than 10 elements gives "Page appears empty - consider waiting".
  - More than 20 elements, with fewer than 5 text chars per element, while network requests are in flight, gives "page
    may still be loading". This detects skeleton screens.
- `[Start of page]` / `[End of page]` sentinels appear when nothing is above or below the viewport (`:259-280`).
- The pending-request list comes from **pure JS** (`dom_watchdog.py:93-240`): resource timing entries with
  `responseEnd === 0`, filtered by a list of ad/analytics domains, dropping requests older than 10 s and
  images/fonts older than 3 s, at most 20 entries. When something is pending the build waits only **0.3 s**
  (`dom_watchdog.py:268-290`).
- `detect_pagination_buttons` (`service.py:1167-1245`) classifies next/prev/first/last/page-number controls with
  multilingual patterns.
- The 0.x prompt explains the format and the `*[` marker (`agent/system_prompts/system_prompt.md:40-63`). It tells
  the model to wait one step after typing into a combobox, so suggestions show up as `*[` (`:89`).

### 1.8 Highlights and screenshots in 0.x

- The model gets a **clean** screenshot. `ScreenshotWatchdog` removes highlights before capturing
  (`browser/watchdogs/screenshot_watchdog.py:55-60`). The DOM build and the screenshot run in parallel
  (`dom_watchdog.py:358-418`).
- After the state is built, `add_highlights` injects a fixed-position overlay container into the page so a **human
  watching** sees boxes and indexes (`browser/session.py:3229-...`, gated by `dom_highlight_elements`).
- `browser/python_highlights.py` (546 lines) is a Pillow renderer. It draws dashed boxes colored by tag (button
  `#FF6B6B`, input `#4ECDC4`, select `#45B7D1`, a `#96CEB4`, textarea `#FF8C42`, other `#DDA0DD`; `:70-100`). It
  places the index label at the top center, or above the element when the element is narrower than 60 px or shorter
  than 30 px (`:181-190`). It shows the index **only when the element's meaningful text is under 3 chars** (`:386-394`).
  In 0.13.14 nothing calls it (`grep -rn python_highlights browser_use` returns nothing). The system prompt still
  promises "bounding boxes around interactive elements" (`system_prompt.md:64-66`), so prompt and code disagree in
  that release (inferred).

### 1.9 Click safety in 0.x (relevant to page state)

`_check_element_occlusion` (`watchdogs/default_action_watchdog.py:574-700`) runs `document.elementFromPoint` at the
click point. The element counts as clickable if the hit node equals it, contains it, or is contained by it. It also
accepts label/input associations (`label[for=id]`, a `<label>` ancestor up to 3 levels, an input inside a label). If
the element is occluded, the click falls back to JS `this.click()` (`:876-902`). Checkboxes are verified and retried
with a JS click (`:959-980`). This is pure in-page JS and ports directly.

---

## 2. The 1.0 design: `browser_use/ax.py`

The model drives the page with Python. In ultrafast mode it gets `bu`, whose system-prompt addendum is `AX_PROMPT`
(`ax.py:93-103`).

### 2.1 Settle: event-based waiting, no fixed sleeps (`ax.py:105-172`, `408-450`)

`PROBE_JS` installs one `MutationObserver` per document: the top document and **every same-origin iframe, at any
depth**, found through `window.frames` with `try/catch` (`:149-162`). It counts:

- **real** mutations only. It ignores its own highlight overlay (`:121`, `:127`), attribute writes that do not change
  the value (Google Flights rewrites a class every frame; `:128-129`), and `style` changes on the same element within
  200 ms (`:130-132`).
- `input`/`change` events (`:139`).

The probe returns `{idle, ready, url, title, n, doc, files}`. `doc` is a random number stored on the window, so a new
document is detected even when the URL stays the same (`:146`). `files` says whether any `input[type=file]` exists.

`settle(cap_ms=800, quiet_ms=80)`: loop until `readyState != 'loading'`, the DOM has been idle for at least 80 ms
**measured from when the action started** (`:438`), and no network is busy. The cap grows to 3,000 ms while the
document is loading (`:437`). Network busy means in-flight CDP `Network.*` requests younger than 1.5 s (older ones
are treated as long-poll or analytics; `:418-431`). WebSocket, EventSource, Media, Ping and Manifest are excluded
(`:354`). Context-loss errors mean a navigation is in progress, so the loop keeps going (`:441-445`).
`state()` uses `cap_ms=3000` (`:495`).

### 2.2 Capture (`ax.py:463-488`, `490-511`)

The following run in parallel on an 8-thread pool:

- `Accessibility.getFullAXTree` for the main frame and every child frame (frames that fail give empty node lists;
  context loss is retried up to 21 times at 50 ms).
- `VISIBLE_JS`.
- URL and title (taken from the probe when possible).
- `DOM.querySelectorAll('input[type=file]')`, only when the probe saw one.

### 2.3 Visible-text filter: a cheap visibility oracle (`ax.py:174-197`, `537-541`)

`VISIBLE_JS` walks every text node: the document, open shadow roots, and same-origin `contentDocument`s. For each
text node's parent element (climbing past `display:contents`) it calls
`checkVisibility({checkOpacity:true, checkVisibilityCSS:true})`. It joins the visible texts, lowercased with
whitespace collapsed. An AX `StaticText` is printed only if its folded text **is a substring of that visible
string**. The reason, per the code comments: the AX tree keeps `opacity:0` text, such as pre-rendered success
banners, "which agents then report as success". The filter is not viewport-limited. Text far below the fold is
still "visible".

### 2.4 Walk and format (`ax.py:522-623`)

A recursive walk over the AX tree in tree order:

- `ignored` nodes are passed through to their children (`:533-536`).
- `StaticText` is joined into running text lines. Text already said by the enclosing control's printed name or value
  is dropped through a folded `inside` string (`:537-541`, `:614-617`).
- `heading` becomes `## name`, and its children are suppressed (`:542-547`).
- **Interactive** = has `backendDOMNodeId` and (`role in CONTROLS` or (`focusable` and not `RootWebArea` and (name
  or value or editable))). `CONTROLS` = {button, link, textbox, searchbox, combobox, listbox, option, checkbox, radio,
  switch, slider, spinbutton, tab, menuitem, menuitemcheckbox, menuitemradio, treeitem} (`:27-30`, `:548-553`).
- `BLOCKS` (paragraph, listitem, row, LabelText) flush text lines so text from two blocks is never glued together
  (`:32`, `:554-561`).
- Line format:
  `*[backendNodeId] role "name≤150" = "value≤100" checked|unchecked expanded|collapsed selected disabled focused  options: a | b | … N more`
  (`:565-611`). Details:
  - A label line identical to the control's name is popped (`:563-564`).
  - `disabled` is shown only when the node is not focusable, because aria-disabled controls still take input
    (`:573-574`).
  - A native `<select>` is detected by its `MenuListPopup` child and shown as role `select` with its first 5 options
    (`:579-610`).
  - Native date inputs (`Date`, `DateTime`, `InputTime`) and selects do not recurse into the browser's own widget
    parts (`:612-613`).
- `--- frame <url> ---` separates frames (`:622-623`).
- **Hidden file inputs** (styled uploaders hide them, which removes them from the AX tree) are prepended as
  `[id] file "name" (hidden)` (`:624-637`).
- Header: `[state] <title> | <url> | loading: N` plus any auto-accepted dialog texts. Footer: `[/state]`.
- An empty tree prints a diagnostic: the page did not load (with the net error from `Network.loadingFailed`), or
  "a popup, often in a cross-origin iframe, hides it; screenshot()" (`:651-656`).

### 2.5 Index scheme and new markers

- Ids are Chrome **`backendNodeId`s**, "they work in bu.* and in every CDP DOM command" (`ax.py:97`). They stay the
  same while the node lives and expire on navigation.
- `self.last` maps id to (role, name) for the last print (`:293`, `:602`). `*` marks ids that were not in the
  previous print (`:605`). Action lines reuse role and name to describe the target (`:698-702`).

### 2.6 Compaction (`ax.py:643-665`)

- The default budget is `max=3000` **characters**.
- Over budget, it keeps the **first 80% and the last 20%** of lines, with
  `... N lines cut here (bu.state(max=30000) or js(...))` between them. The last part is kept because "a dialog's
  Done/Submit is usually its last line" (`:657`).
- Other caps around the state:
  - REPL cell output is capped at 12,000 chars, with a path to the full capture (`repl/session.py:42`, `:209-210`).
  - Screenshots are pruned: once 20 tool results carry images, all but the newest 2 lose them, done in one go to keep
    the prompt cache warm (`agent/loop.py:80-86`).
  - History compaction starts at 75% of `max_context_chars` (or 65% of the token window; `loop.py:808`).

### 2.7 Act and verify (`ax.py:704-861`)

- Every action prints one line, `[ok] click [812] button "Search" -> navigated to <url> | page changed | no change`.
  It compares the probe's `doc`, `url` and mutation counter from before and after the action (`:767-803`).
- After any cell whose `bu` actions reached the page, the worker prints the state automatically, with no extra model
  turn (`repl/worker.py:1202-1207`).
- `_point` (`:704-757`):
  1. `scrollIntoViewIfNeeded`.
  2. `POINT_JS` (`:199-218`) refuses the target if it is detached, disabled or `inert`, a file input,
     `checkVisibility`-hidden, zero-size or off-viewport.
  3. Covered check: `elementFromPoint` on the element's root node, with exemptions for a containing `<label>`, and
     for one text field covering another when typing.
  4. Same-origin iframe offsets are added (`frameElement` rect + `clientLeft` + `padding`; `:211-216`).
  5. If covered: center the element with `scrollIntoView({block:'center'})` and retry once (`:713-721`).
  6. Still covered: name the covering element through `DOM.getNodeForLocation` and the nearest named or dialog AX
     ancestor, then raise `Target covered by [id] dialog "Cookie consent"; nothing was clicked` (`:722-757`).
- Click sends press and release, without `mouseMoved` (`:759-765`).
- Type (`:813-861`):
  - A select is set by matching the label: exact, value, or a unique prefix (`SELECT_JS`, `:231-239`). Date inputs
    are set through the native value setter and must be ISO (`DATE_JS`, `:241-245`).
  - Otherwise: click, detect focus moving to an overlay input (`MOVED_JS`), select all, `insertText(all but the last
    char)`, then a real key event for the last char so autocompletes fire (`:842-847`). It reads the value back and
    reports `(field now shows "...")` when it differs.

### 2.8 Action highlights in 1.0 (`browser_use/repl/highlight.py`)

There is no index overlay. Orange corner brackets (`rgb(255,127,39)`) are drawn for 1 s around whatever a click,
focus or `insertText` reached. The overlay is created in a **closed shadow root**, `aria-hidden`,
`pointer-events:none`, `z-index:2147483647` (`:18-44`), so the AX tree, the text and clicks never see it. The
bracket size is `clamp(8, 0.35*min(w,h), 20)`. The overlay is removed before any screenshot, and draws are held
until the capture is done (`:123-131`).

---

## 3. Signal by signal: CDP source versus native-webview equivalent

| Signal browser-use uses | Where | Native equivalent (isolated content world JS unless noted) | Accuracy trade-off |
|---|---|---|---|
| DOM tree with stable ids (`backendNodeId`) | 0.x `service.py:583-585`; 1.0 ids everywhere | TreeWalker over document + open shadow roots + same-origin frames. Ids from a `WeakMap<Node,int>` with a monotonic counter kept per document in the isolated world; it survives between snapshots | Same stability within a document. Ids are per frame-world, so prefix them per frame (for example `f2:123`). Closed shadow roots are unreachable (see below) |
| Closed shadow roots (`pierce: true`) | `service.py:584` | No direct path. Option (inferred): a page-world `WKUserScript` at document start wraps `Element.prototype.attachShadow` and records closed roots, but the isolated world cannot read page-world JS objects, so the hook would have to do the snapshotting there or force `mode:'open'` | Loses closed-root content, or changes page behavior. Open roots (most frameworks) are fully covered |
| Full AX tree: role, name, properties | 0.x `service.py:357-401`; 1.0 `ax.py:463-488` | Compute in JS: implicit-role table + explicit `role` + ARIA accessible-name algorithm (accname 1.2) + states from DOM (`el.checked`, `aria-checked`, `aria-expanded`, `:disabled`, `aria-disabled`, `required`, `:invalid`/`aria-invalid`, `selected`, `isContentEditable`, tabindex focusability). macOS alternative (inferred, open question): the host process walks its own WKWebView's NSAccessibility tree | JS accname gets most names right. It misses UA-internal parts (date-picker sub-fields, `MenuListPopup`), and it is weaker on `aria-owns` re-parenting, CSS-generated `::before/::after` content (readable via `getComputedStyle(el,'::before').content`), and "ignored" pruning. Native AX gives exact WebKit semantics but no DOM-node mapping |
| Live input values | `enhanced_snapshot.py:118-128` | `el.value`, `el.checked`, `selectedOptions`, `isContentEditable ? innerText`. Apply the same redaction rules (password/file/hidden, `cc-*`, `one-time-code`) | Exact. Better than CDP, since it is read straight from the element |
| Computed styles (display, visibility, opacity, overflow, cursor, pointer-events, position, background-color) | `enhanced_snapshot.py:17-29` | `getComputedStyle(el)` | Exact. It is slower per element, so read styles only for candidate elements and cache them per snapshot |
| Visibility (CSS + has a box) | `service.py:251-283` | `el.checkVisibility({checkOpacity:true, checkVisibilityCSS:true})` (WebKit has shipped it since Safari 17.4, inferred) plus `getClientRects().length > 0`. Fall back to computed styles plus walking ancestors' `opacity` | `checkVisibility` handles inherited `opacity:0`, `content-visibility` and `display:contents`. Better than 0.x's own-node-only opacity check |
| Bounds (document coords, CSS px) | `enhanced_snapshot.py:150-163` | `getBoundingClientRect()` + `scrollX/Y`. `getClientRects()` for wrapped inline links | Exact. Transforms are included (the bounding box of the transformed shape) |
| Viewport intersection ±1000 px through the frame chain | `service.py:285-355` | Same arithmetic in JS. For each same-origin frame, add `frameElement` rect + `clientLeft/Top` + padding (as `ax.py:211-216`) | Exact for same-origin frames. Cross-origin frames need host-side stitching (below) |
| `scrollRects`/`clientRects`, `isScrollable` | `views.py:627-676` | `scrollWidth/Height`, `clientWidth/Height`, `scrollTop/Left` + computed `overflow*` | Exact. CDP's own `isScrollable` flag is matched by `scrollHeight > clientHeight + 1` together with overflow `auto/scroll/overlay` |
| **Paint order** (global z-order) | `paint_order.py:146-225` | No equivalent. Approximate it with **hit-testing**: for each candidate inside the viewport, `elementsFromPoint` (or `root.elementFromPoint` in shadow roots) at the center and 4 inset points. Mark the candidate covered if no sample lands on it, an ancestor of it, or a descendant of it. Text nodes: `Range.getClientRects()` + the same sampling | Hit-testing matches **what a click would hit**: it respects `pointer-events:none`, and it treats a transparent full-screen overlay as covering, which 0.x's "transparent backgrounds do not occlude" rule misses. It cannot test outside the viewport (`elementFromPoint` returns null there), so off-screen candidates stay "unknown, keep". Cost is about 5 hit tests per candidate. Budget a few hundred per snapshot |
| `isClickable` (Chrome rare flag) and `getEventListeners` | `enhanced_snapshot.py:115-116`; `service.py:456-567` | Page-world document-start hook on `EventTarget.prototype.addEventListener` that tags targets for click/pointer/mouse events (for example in a `WeakSet` mirrored into a `data-` attribute, or reported through a message handler), plus `onclick` properties/attributes (inferred design) | React and others delegate events to the root, so per-element listener detection is weak anyway (inferred). `cursor:pointer`, roles and tabindex catch most cases, as 0.x's fallbacks already do. A page-world hook can be detected by hostile pages |
| Network in flight (CDP `Network.*`) | 1.0 `ax.py:345-360`, `418-431` | Page-world wrappers for `fetch`/`XMLHttpRequest` that count requests in flight, plus a `PerformanceObserver('resource')` for completions, plus the host's `WKNavigationDelegate` for document loads and errors (`didFailProvisionalNavigation` gives the error text) | It misses requests the page cannot see (service workers' own fetches, `<img>` loads before timing entries appear). 0.x already uses resource timing as a pure-JS signal (`dom_watchdog.py:93-240`), though `responseEnd===0` entries are rare because entries are usually added on completion (inferred) |
| DOM quiet window | `ax.py:109-172` | Identical code (MutationObserver in the isolated world observes the shared DOM) | Exact. This part needs no CDP at all |
| Dialogs (`Page.javascriptDialogOpening`) | `ax.py:326-338` | `WKUIDelegate runJavaScriptAlertPanel/Confirm/TextInput` handled natively; report the text in the next state header | Exact, and simpler than CDP |
| Frame enumeration (`Page.getFrameTree`) and per-frame AX | `service.py:357-401`; `ax.py:465-483` | Same-origin: `window.frames` / `contentDocument` from the top frame. Cross-origin: the host evaluates the snapshot script in each `WKFrameInfo`, then maps frames to `<iframe>` elements with a postMessage handshake (the parent's isolated script posts a nonce to `iframe.contentWindow`, and the child reports it with its frame info through `WKScriptMessageHandler`) (inferred). URL matching, as 0.x does (`service.py:1016-1031`), is the fallback | It works on macOS, where `WKFrameInfo` reaches cross-origin frames. On WebKitGTK cross-origin frame evaluation may be limited (open question) |
| Screenshot | 0.x `screenshot_watchdog.py`; 1.0 `repl/capture.py` | `WKWebView takeSnapshot` (viewport) | Equivalent. Remove highlight overlays first, as both versions do |
| `DOM.getNodeForLocation` (what covers the point) | `ax.py:722-757` | `elementFromPoint` / `elementsFromPoint` at the same point; name the covering node with the JS role/name computation | Exact, including for shadow roots via `root.elementFromPoint` |
| `Input.dispatchMouseEvent` / `insertText` / `dispatchKeyEvent` | `ax.py:759-765`, `836-868` | Native trusted mouse and keyboard events posted to the view, with coordinates from the JS point computation. Text through native key events or the text-input client | Trusted events, as with CDP. Native IME paths are slower for long strings (inferred) |
| `DOM.setFileInputFiles` | `AX_PROMPT` `ax.py:100` | `WKUIDelegate runOpenPanelWithParameters` supplies the files when the input is clicked natively | Different flow (click, then the delegate answers), same outcome |

---

## 4. What to copy, and how, for Misty's wry harness

1. **Use the 1.0 AX-line format as the main state.** Its features:
   - Flat list in page order.
   - `[id] role "name" = value states`.
   - `## heading` lines.
   - Text joined into blocks and deduplicated against control names.
   - `*` for ids new since the last print.
   - Head 80% / tail 20% cut at a character budget.

   It is compact (3,000 chars by default), and any model can read it without being told about HTML. Build it entirely
   in one isolated-world JS function that returns `{lines, idsMeta}`.
2. **Take 0.x's interactivity rules into the "is this a control" decision**, because our JS role computation will
   miss what Chrome's AX tree catches:
   - `cursor:pointer`.
   - `tabindex`.
   - `onclick`.
   - The icon-size rule (10-50 px with class, aria-label or role).
   - Labels that wrap inputs (and the rule that `label[for]` is not a control).
   - Search-class hints.

   Then **collapse descendants with 0.x's 99% containment rule** inside `a`, `button` and `[role=button|combobox]`.
3. **Take 0.x's per-control enrichments**, printed on the same line:
   - Date/time `format=` hints and the datepicker class detection.
   - Select option count, first options and format hint.
   - File input current value.
   - Range min/max.
   - The image alt/src-filename context for icon-only controls.
   - Scroll containers with "X pages above, Y pages below".
   - The iframe "N more elements below, ~X pages down" hint.
4. **Keep 1.0's text-visibility check** (`checkVisibility` with opacity on the text's parent). It is what stops false
   "success" readings. Add a **hit-test occlusion pass** for candidates inside the viewport, so a control under a
   modal is either dropped or marked `covered by [id] dialog "..."`. That covers what paint order did, in a way that
   matches click behavior.
5. **Ids**: a monotonic counter in a per-document `WeakMap`, so ids stay put across steps like `backendNodeId` (this
   is what makes `*` markers meaningful), with a frame prefix. Reset on a new document. Detect a new document with
   1.0's random `doc` token (`ax.py:146`), not the URL.
6. **Settle and change reporting**: port `PROBE_JS` and `settle()` almost verbatim. Replace the CDP network counter
   with page-world fetch/XHR wrappers and the navigation delegate. Keep the 80 ms quiet window, the 800 ms action cap,
   the 3 s state cap and the 1.5 s long-poll cutoff. Print `navigated to / page changed / no change` after every
   action, and print the state automatically after a cell that acted.
7. **Action safety**: port `POINT_JS` checks (detached, disabled, inert, hidden, off-viewport, covered) and the
   "center and retry once" step. Raise errors that name the covering element; do not force clicks through it.
8. **Highlights**: 1.0's closed-shadow-root corner brackets for human watchers. Remove them before every
   `takeSnapshot`, and have the mutation probe ignore them. Skip index labels in model screenshots, as both versions
   now do.
9. **Redaction**: copy 0.x's rule that password, hidden, file, `cc-*` and `one-time-code` values never leave the
   snapshot.

---

## 5. Notable thresholds (quick reference)

| Constant | Value | Location |
|---|---|---|
| Viewport inclusion margin | ±1000 px vertical | [0.x] `service.py:64`, `:339-344` |
| Containment for child suppression | 0.99 | [0.x] `serializer.py:58` |
| Occluder opacity floor / transparent bg excluded | 0.8 / `rgba(0, 0, 0, 0)` | [0.x] `paint_order.py:207-217` |
| Rect-union cap | 5,000 | [0.x] `paint_order.py:52` |
| Click-listener scan caps | 10,000 elements / 100 hits / describe batches of 20 | [0.x] `service.py:34-35`, `:477` |
| Cross-origin iframe min edge / depth / count | 10 px / 5 / 100 | [0.x] `service.py:37`, `:62-63` |
| Iframe processed as scroll target | >100x100 px | [0.x] `clickable_elements.py:46-52` |
| Icon heuristic | 10-50 px both axes | [0.x] `clickable_elements.py:228-240` |
| Attribute value cap / select options shown | 100 chars / 4 (30 chars each) | [0.x] `serializer.py:1398`, `:405-417` |
| Element text budget | 40,000 chars, head cut | [0.x] `prompts.py:117` |
| CDP tree timeouts | 10 s + 2 s retry | [0.x] `service.py:598`, `:623` |
| Pending-request wait | 0.3 s | [0.x] `dom_watchdog.py:286-288` |
| State budget / split | 3,000 chars, 80/20 head/tail | [1.0] `ax.py:490`, `:657-665` |
| Name / value clip | 150 / 100 chars | [1.0] `ax.py:607-608` |
| Settle quiet / action cap / state cap / loading cap | 80 ms / 800 ms / 3,000 ms / 3,000 ms | [1.0] `ax.py:408`, `:437`, `:495` |
| Long-poll cutoff | 1.5 s | [1.0] `ax.py:422` |
| Style-mutation debounce | 200 ms per element | [1.0] `ax.py:130-131` |
| Page evaluate timeout | 15 s | [1.0] `ax.py:38` |
| Cell output cap | 12,000 chars | [1.0] `repl/session.py:42` |
| Image pruning | at 20 image results, keep 2 | [1.0] `agent/loop.py:84-86` |
| History compaction trigger | 75% of chars / 65% of token window | [1.0] `agent/loop.py:808` |

---

## 6. Open questions

- Can the Misty host read its own WKWebView's native accessibility tree (`NSAccessibility` /
  `accessibilityChildren` inside our process, without the TCC Accessibility permission)? If so, how do we map AX
  elements back to DOM nodes (perhaps by matching frame and position)? That would give WebKit-exact roles and names
  for free on macOS.
- How much of cross-origin frame evaluation does WebKitGTK expose through wry (the equivalent of `WKFrameInfo`
  targeting)? Can the postMessage frame-identity handshake run in an isolated world on both platforms?
- Closed shadow roots: is a page-world `attachShadow` hook acceptable under the permissions and sandbox policy, given
  it can be detected and changes page-visible behavior?
- Is the cost of hit-test occlusion (about 5 `elementsFromPoint` per candidate) acceptable on heavy pages (more than
  1,000 candidates), or should we sample only candidates near modals and fixed-position layers?
- Which format scores better on BU Bench and Odysseys with Opus: 1.0's flat AX lines, or 0.x's indented
  pseudo-HTML? browser-use itself moved to the AX lines; we should A/B both with the same harness.
