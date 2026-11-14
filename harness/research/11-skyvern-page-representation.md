# 11 - Skyvern: how a page is represented to the model

Source studied: Skyvern checkout at commit `cc5ef72bd9fe` (2026-11-14), read only, never executed.
All paths below are relative to the Skyvern repo root. "(inferred)" marks conclusions I drew rather than read.

## 0. TL;DR

Skyvern's page representation is almost entirely **one injected JavaScript file**,
`skyvern/webeye/scraper/domUtils.js` (4,201 lines). It walks the DOM (open shadow roots included),
decides per element "visible?", "interactable?", "worth keeping for structure/text?", stamps each kept
element with a `unique_id="XXXX"` DOM attribute, and returns two things: a flat `elements` list and a nested
`element_tree`. Python (`skyvern/webeye/scraper/scraper.py`, `scraped_page.py`) then:

1. walks child frames with Playwright and runs the same JS in each frame, grafting each frame's tree under its `<iframe>` node;
2. post-processes the tree (deletes rects, swaps SVGs/icon-glyphs for LLM-generated shape descriptions, whitelists ~28 attributes, drops ids from non-interactables);
3. serializes it to a **compact pseudo-HTML** string (`json_to_html`) in which every actionable node carries `id="<unique_id>"`, custom dropdowns are renamed to `<select>`, and `<select>` options are inlined as `<option index=N>`;
4. keeps the prompt under budget with a staged fallback (100k tokens -> "economy" tree without SVG -> keep first 2/3 with popups moved to the front -> 180k hard ceiling with tag-boundary truncation);
5. takes up to 10 **viewport** screenshots by scrolling the window in JS (200 px overlap). The old Set-of-Marks bounding-box overlay still exists in the JS but is **deprecated and off** (`draw_boxes=False` everywhere).

The model acts by returning one of those ids; Python resolves it as the CSS selector `[unique_id='XXXX']`
inside the frame chain recorded at scrape time. For the native-webview port, roughly 90% of the
representation logic is pure in-page JS and moves to a WKWebView content world almost unchanged. The parts
that are Playwright/CDP are: frame enumeration and per-frame evaluation, the iframe-element-to-frame mapping,
`page.screenshot`, `wait_for_load_state("networkidle")`, and the locator-based checks used during SVG/CSS-shape
conversion. Every one of those has a native-webview replacement (section 11).

## 1. Injection model (how the JS gets into the page)

- `load_js_script()` reads `domUtils.js` and wraps it with `_wrap_js_in_isolated_scope` (`skyvern/webeye/utils/page.py:432-455`). Despite the name, this is **not** an isolated world: it puts the script in an IIFE and then copies every top-level declaration onto `globalThis` (regex `_JS_TOP_LEVEL_DECL_RE`, `page.py:405-408`). The point is to avoid `Identifier already declared` collisions with the site's globals.
- Every call goes through `with_dom_utils(expression, required_helpers)` (`page.py:475-498`): the generated function first checks that each named helper exists on `globalThis`; if not it returns a sentinel `{"__skyvern_dom_utils_missing__": true}`. `_evaluate_expression` (`page.py:2389-2420`) sees the sentinel, re-runs the bootstrap (`JS_FUNCTION_DEFS`) and retries, up to `_NAVIGATION_RECOVERY_MAX_ATTEMPTS = 4` (`page.py:490`). This makes injection lazy and navigation-proof: no init script is required.
- The wrapper also sets two feature flags per call: `window.GlobalEnableAllTextualElements` and `window.GlobalEnableEnrichedElementTree`.
- Evaluation is deliberately in the **main world**: `skyvern/webeye/main_world_eval.py:44-59` monkey-patches the driver's `evaluate` family to default `isolated_context=False`, and `_dispatch_evaluate` (`page.py:827-850`) prefers a CDP `Runtime.evaluate` main-world path when a prefix is configured. Main world is needed because several interactability heuristics read page JS state: `window.jQuery._data(el,"events")` (`domUtils.js:1445-1454`), Angular's `element.__ngContext__` (`domUtils.js:1618-1642`), `typeof ASPxClientControl` (`domUtils.js:410-412`).
- The code is aware of the cost: comments in `domUtils.js:2058-2066` and `2598-2604` discuss a hostile page calling the exported functions mid-build and forging "destination facts", and add budgets to fail closed.

**CDP dependency:** partial (only the main-world CDP prefix path; plain `frame.evaluate` works too).
**Native path:** run domUtils in a dedicated `WKContentWorld` (isolated, page cannot call or tamper with it, removing the whole class of hostile-page concerns Skyvern defends against). For the three main-world heuristics, add a tiny companion script in `WKContentWorld.page` that, on request, stamps `data-misty-has-click="1"` on elements with jQuery/Angular click bindings (the attribute is visible to the isolated world through the shared DOM). Inject with `WKUserScript` at document end into all frames (`forMainFrameOnly: false`) and keep Skyvern's "check-then-bootstrap" guard for robustness.

## 2. Element discovery: the DFS in `buildElementTree`

Entry point `buildTreeFromBody(frame, frame_index, must_included_tags, captureDestinationFacts)` (`domUtils.js:2579-2629`) calls `buildElementTree(document.documentElement, ..., maxElementNumber = 15000)` (`domUtils.js:2612`).

`processElement(element, parentId, parent_xpath, index)` (`domUtils.js:2662-2848`) is a recursive pre-order DFS:

1. Stops when `elements.length >= maxElementNumber` (15,000 per frame) or an element budget is exhausted (`2673-2681`).
2. Skips `<head>`, Skyvern's own cursor overlay (`data-pw-overlay`), and `<option>` (options are folded into their `<select>`) (`2689-2701`).
3. Computes an XPath of the form `/*[name()="div"][2]/*[name()="span"][1]` (namespace-agnostic so SVG works) (`2703-2715`); `null` inside shadow DOM (`2842-2846`, flagged FIXME).
4. Collects open-shadow-root children separately (`2717-2721`).
5. If `isElementVisible && !isHidden && !isScriptOrStyle`, it decides whether to build an element object (`2722-2777`). An element is **kept** when any of these hold, in order:
   - `isInteractable(...)` is true (or tag is in `must_included_tags`);
   - it is `iframe`/`frame`/`frameset` (needed as a graft point for the frame's subtree);
   - it hosts a shadow root;
   - it is table structure (`table, thead, tbody, tr, th, td, caption, colgroup, col`, `1041-1055`): kept to preserve grid structure;
   - it has `::before`/`::after` content (icon fonts);
   - it is `<svg>` or a descendant of an already-tagged `<svg>`;
   - it is a `div` with `display:flex` and more than one child (`isDOMNodeRepresentDiv`, `1057-1069`): kept as a layout grouping;
   - `<embed type="application/pdf">` (kept as `purgeable`);
   - its *own* direct text (not descendants) is 1-5,000 chars (`getElementText`, `1822-1849`, joins direct text nodes with `;`, including bare text nodes inside an open shadow root);
   - in `full_tree` mode (incremental / must_included_tags), everything else is kept as `purgeable` (rendered as children only).
6. The new object is appended to its nearest kept ancestor's `children`, otherwise it becomes a root; then recursion continues with this element as parent (`2779-2840`). Non-kept elements are transparent: their kept descendants attach to the nearest kept ancestor. This "skip the wrappers" collapse is the single biggest compaction step.

After the walk (`2899-2928`): `removeOrphanNode` drops `<label>` nodes with no children, no `for`, no text (`2876-2897`), and `trimDuplicatedText` subtracts each child's text and option text from the parent's text, collapsing repeated `;` (`2850-2873`).

### 2.1 Visibility (`isElementVisible`, `domUtils.js:476-596`)

Derived from Playwright's injected `domUtils.ts` (attribution comments at 363, 370, 474, 598, 621, 632, 643). Rules:

- Inputs/textarea/select inside a shadow root are force-visible (web-component libraries hide the native control under a styled overlay) unless the host or a combobox sibling reports `aria-expanded="false"` (`486-511`).
- `<option>` and radio/checkbox inputs take their **parent's** visibility (custom checkboxes often hide the native input) with a cycle guard (`515-526`).
- select2 offscreen classes are invisible (`528-535`).
- `display:contents` -> visible iff any child element/text node is visible (`539-554`).
- `isElementStyleVisibilityVisible` (`371-408`): `checkVisibility()` when available, **except on WebKit** where it falls back to a manual closed-`<details>` check because of WebKit bug 264733; `visibility` must be `visible`; `clip: rect(0,0,0,0)` / `rect(1px,...)` is invisible.
- Zero-size rect is invisible unless it looks hover-revealed (`isHoverOnlyElement`, `415-450`: class names containing `hover`, or an ancestor within 5 levels whose class contains `hover`/`card`/`item`) or is a pointer-cursor icon drawn with pseudo content (`556-573`).
- Off-screen check is **X only**: element center x < 0 is invisible unless inside a horizontally scrolled container (data grids) (`575-589`). Y is deliberately not checked, so content below the fold is kept. The tree is a whole-page representation, not a viewport representation.

`isHidden` (`744-762`) adds `display:none` and the `hidden` attribute (with an exception for pointer-cursor submit buttons).

**Not done at scrape time: occlusion.** Nothing in the DFS calls `elementFromPoint`. Occlusion is only checked on demand via `getBlockElementUniqueID` -> `expectHitTarget` (`644-742`, Playwright's hit-target algorithm across shadow roots, with a WebKit element-order workaround at `680-692`), used by Python when clicking and when deciding whether an SVG is worth converting (`skyvern/forge/agent_functions.py:680-730`). Hidden/disabled state is surfaced through attributes instead.

### 2.2 Interactability (`isInteractable`, `domUtils.js:1251-1474`)

A long, empirically grown rule list, evaluated in order:

1. Not visible / hidden / script|style -> false.
2. ARIA widget role -> true: `button, link, checkbox, menuitem*, radio, tab, combobox, searchbox, slider, spinbutton, switch, gridcell, option`, and `textbox` unless readonly (`1010-1039`).
3. `pointer-events:none` (not disabled) -> false unless hover-only.
4. Any `<input>` except `type=hidden`, deliberately without a valid-types whitelist (sites use `type="city"` etc.) (`1113-1126`).
5. Widget-library special cases: bootstrap-datepicker `th.prev/.next/.datepicker-switch` or `« » ‹ ›` (`1128-1178`), DataTables `td.select-checkbox` (`1180-1191`), Kendo dropdown value spans (`1193-1240`).
6. `html`, `iframe`, `frame`, `frameset` -> false.
7. `a[href]`, `button`, `select`, `option` (if parent select enabled), `textarea`, `label` with an enabled `.control` -> true.
8. `onclick`, `contenteditable`, `jsaction` (Google) attributes -> true.
9. Angular `ng-click`, class `blinking-cursor` / `svg-container`; `ul/div[role=listbox]`, `li/div[role=option]`; `li.ui-menu-item/.dropdown-item/.rddlItem`; Google Places `.pac-item`; `div[aria-disabled=false]`; spans inside `div[id*=dropdown-container]` (`1344-1408`).
10. For a broad tag set (`div img span a i li p td svg strong h1-h4` and any custom tag whose name contains button/select/option/textarea): `cursor:pointer`, or a `:hover` stylesheet rule that sets `cursor` matching the element, or Tailwind `hover:cursor-pointer` (`1410-1435`, `isHoverPointerElement` `1071-1111`).
11. ASP.NET DevExpress `tr`, `div[data-selectable]`, jQuery click handlers, Angular Ivy click listeners, `div[tabindex=0]` (`1437-1471`).

`getHoverStylesMap` (`3478-3589`) parses every stylesheet's `:hover` rules (keeping only those that set `cursor`), and for cross-origin sheets that throw `SecurityError` it re-`fetch`es the CSS with `mode:"cors"` and parses it into a constructed `CSSStyleSheet`, deliberately without touching the DOM. Cached on `window.globalHoverStylesMap` for the page lifetime.

**CDP dependency:** none. All of section 2 is DOM + CSSOM. On WebKit, set `browserNameForWorkarounds = "webkit"` (hard-coded `"chromium"` at `domUtils.js:2`) so the `checkVisibility` workaround activates. The cross-origin CSS `fetch` from an isolated content world runs with the page's origin (inferred) and is subject to the same CORS rules; it is optional.

## 3. Element ids

- Stored as a real DOM attribute `unique_id` (`skyvern/constants.py:5`, `SKYVERN_ID_ATTR`). That is why both JS and Python can find the element later with `document.querySelector('[unique_id="..."]')`.
- Format (`domUtils.js:1898-1942`): base-62 prefix encoding the frame index (`window.GlobalSkyvernFrameIndex`, main frame 0 -> `"A"`), then 3 base-62 characters from a per-window monotonically increasing `SafeCounter` (mod 62^3 = 238,328). Example: main frame element #1 = `AAAB`. Without a frame index a random symbol from `~!@#$%^&*()-_+=` is the prefix. Ids are 4-6 characters, cheap in tokens.
- `ownUniqueId` (`1946-1964`) **reuses** an existing id if this window minted it, so ids are stable across re-scrapes of the same document (the counter lives on `window`, the attribute lives on the node). Nodes moved between frames are re-minted.
- Python `build_element_dict` (`scraper.py:309-348`) builds `id -> css` (`[unique_id='X']`), `id -> element`, `id -> frame`, and `id -> sha256(element without id/rect/frame_index)`. On cross-frame id collisions, the first (breadth-first, parent) frame wins.
- The element hash and `structural_identity` (`scraper.py:225-306`) let later steps recognize "same element" after a remount, used for caching and stale-action checks.

**CDP dependency:** none. **Native:** identical. One consideration: the attribute is visible to page scripts and to `MutationObserver`s (Skyvern filters its own `unique_id` mutations at `domUtils.js:3777` and `scraper.py:542-553`). Using an isolated world does not hide DOM attributes; a `WeakMap<Element,id>` inside the content world plus a short attribute only when needed would be stealthier (inferred trade-off: attribute lookup is what makes cross-world and cross-call resolution trivial).

## 4. The element object

`buildElementObject` (`domUtils.js:2381-2576`) emits:

```
{ id, frame, frame_index, interactable, hoverOnly, tagName,
  attributes: {...all DOM attributes, normalized...},
  beforePseudoText, text, afterPseudoText, children: [],
  purgeable, keepAllAttr (svg subtree), isSelectable,
  shadowHost?: <host unique_id>, options?: [{optionIndex,text,value}],
  xpath, destination? }
```

Normalizations worth copying:

- Boolean-ish attributes (`required, checked, selected, readonly, disabled, aria-*` of those, `aria-invalid`, `aria-expanded`) become real booleans; the **DOM property wins** over the attribute (`2409-2497`). So a checkbox always reports `checked: true|false` from `element.checked`.
- Style-derived flags: `react-datepicker__day--disabled` class -> `disabled`; `::after` content containing `*`, `✱` or "require", or a class containing `require` -> `required` (`1764-1796`).
- `input/textarea` get `attributes.value = element.value` (live value, not the attribute). Passwords and detected OTP digit boxes are masked with `*` repeated to the length (`2499-2508`, OTP heuristics `2211-2379`: `maxlength=1` or numeric `inputmode/pattern` boxes grouped >= N in one container).
- Optional "enriched tree" (`2006-2042`): `invalid`, `validationMessage` (from `element.validity`), `errorText` resolved through `aria-errormessage`/`aria-describedby`, each truncated to 120 chars.
- `<select>` gets `options` (index/text/value) and `attributes.selected = <selected option text>` (`1851-1871`, `2547-2559`), bounded by the element budget.
- `isSelectable` (`2529-2538`) marks things that should be *presented as a select*: native `select`, `button[data-testid*=date]`, `div[role=combobox][aria-controls][aria-haspopup]`, `button[type=button]` with `aria-expanded` or `aria-haspopup=listbox`, Angular `ng-*` inputs whose aria-label mentions select/choose, Angular Material datepicker inputs, select2 widgets, readonly `.custom-select` inputs.
- `destination` (`2095-2209`): for anchors and form controls, the resolved URL and method a click would send data to, for an action firewall; explicitly marked tamperable and stripped by Python (`page.py:2276`, `pop_destination_facts`).

## 5. Python post-processing: from tree to prompt text

### 5.1 `cleanup_element_tree` (`skyvern/forge/agent_functions.py:3316-~3420`)

BFS over the tree: remove `rect`; for `<svg>` nodes check eligibility (locator exists, visible, not occluded via `getBlockElementUniqueID`, `680-730`) and then ask a secondary LLM to name the shape (`svg-convert.j2`: returns `shape`, `recognized`, `confidence_float`). The SVG node's children are deleted and `alt="<shape>"` is set (`768-890`). SVGs larger than `SVG_MAX_LENGTH = 100000` chars, or past `SVG_MAX_PARSING_ELEMENT_CNT = 3000` elements, are dropped (`skyvern/config.py:912-913`). Text-less, child-less `span/i/button` (and `a` without href/target) are "CSS shapes" (`430-460`): Skyvern scrolls them into view, takes an **element screenshot**, and asks the LLM what the icon means, storing `shape-description` (`893-1049`). Results are cached by sha256 of the serialized HTML (Redis + a 4,096-item local cache; failures cached as `N/A` for 1 hour or 1 week). Retries: SVG 3 attempts with 0.5*2^n s backoff, CSS 1 attempt, 30 s LLM timeout (`agent_functions.py:182, 210-212`).

### 5.2 `trim_element` (`scraper.py:1443-1536`)

- Drops `frame`, `frame_index`.
- Drops `id` unless the node is interactable, hover-only, or disabled/readonly (so the model sees *why* it cannot use it) (`_should_keep_unique_id`, `1417-1440`). Non-interactable context nodes are id-less: the model cannot target them.
- Drops `data:` URIs in `href/src/poster/srcset/icon` (`213-219`, `1508-1516`).
- Whitelists attributes to `RESERVED_ATTRIBUTES` (`159-189`): `accept, alt, aria-checked, aria-current, aria-disabled, aria-label, aria-readonly, aria-required, aria-role, aria-selected, checked, data-original-title, data-ui, disabled, for, href, maxlength, name, pattern, placeholder, readonly, required, selected, shape-description, src, text-value, title, type, value`, plus `role` only when it is `listbox`/`option`. The enriched mode adds `aria-describedby, aria-errormessage, aria-expanded, aria-haspopup, aria-invalid, aria-labelledby, errorText, invalid, validationMessage` (`191-203`). Note `class` and `id` are **dropped**, except `class` (cut to 100 chars at a word boundary) on icon-only interactables with pseudo content (`1463-1471`, `1529-1534`). SVG subtrees keep all attributes (`keepAllAttr`).
- `name` truncated to 500 chars; empty `text`, pseudo text and `children` removed.

### 5.3 Serialization: `json_to_html` (`skyvern/webeye/scraper/scraped_page.py:66-135`)

- `<tag attrs id="X">beforePseudo text children options afterPseudo</tag>`; booleans render as `checked="true"`, empty strings as bare `key`.
- `isSelectable` nodes are **renamed to `<select>`** so the model reaches for `SELECT_OPTION` on custom dropdowns.
- Options render as `<option index="3">Texas</option>` (value only when text is empty).
- `purgeable` nodes emit only their children.
- Private-Use-Area glyphs (icon fonts) in pseudo text become `[icon]` (`50-56`).
- `href` longer than 150 chars is replaced by `{{_<sha256>}}` and the real URL is kept in `context.hashed_href_map` (`83-91`), so the model can still "click the link" or copy it by token without paying for the URL.
- Self-closing tags `img input br hr meta link` render without a close tag.

Illustrative output (constructed from the rules above, inferred, not copied from a run):

```
<form><div><label for="email">Email *</label><input type="email" name="email" required="true" value="" id="AAAk"></div>
<select aria-label="State" id="AAAm"><option index="0">Select</option><option index="1">Alabama</option></select>
<button type="button" aria-expanded="false" id="AAAn">Pick a date</button>
<svg id="AAAp" alt="magnifying glass, search"></svg><a href="{{_9f2c...}}" id="AAAq">Download invoice</a></form>
```

The prompt then says the elements are tagged with ids and must be used verbatim (`skyvern/forge/prompts/skyvern/extract-action.j2:3-11, 27, 108-109`), and wraps the tree in an `untrusted` filter with a security preamble (line 1).

Also attached: `get_frame_text` = `document.body.innerText` of the main frame plus visible child frames (`scraper.py:485-530`), the raw `page.content()` HTML, and viewport size.

## 6. Keeping the tree within token limits

Layered, cheapest first:

1. **In-page caps:** 15,000 element objects per frame (`domUtils.js:2612`), 3,000 per incremental observation (`3642`), select options charged against the same budget (`2390-2398`), 5,000-char per-element text cap (`2761-2763`), 512 KiB destination-fact budget.
2. **Structural collapse:** non-interesting wrappers vanish (section 2), duplicate text removed, ids dropped from non-interactables, attribute whitelist.
3. **Lean transforms** (opt-in per template, `skyvern/utils/lean_html.py`): strip query strings from href/src, drop `<img src>`, long href -> `#templated`, drop `#`/`javascript:void(0)` hrefs (keep a `javascript:` payload only when it is the control's only label). Measured savings in the file header: about 12% combined; Skyvern ids alone were about 24% of the verifier prompt and are dropped with `html_need_skyvern_attrs=False` for prompts that do not act.
4. **Economy tree** when the rendered prompt exceeds `DEFAULT_MAX_TOKENS = 100000` (`skyvern/constants.py:161`; `skyvern/utils/prompt_engine.py:151-170`): remove every `<svg>` subtree (`scraped_page.py:481-498`).
5. **Keep 2/3** if still over (`prompt_engine.py:171-195`): character slice of the HTML, but first move root nodes containing `role=listbox|option` (within depth 4) to the front so popups and portals, which are appended at the end of `<body>`, survive truncation (`scraped_page.py:455-514`).
6. **Hard ceiling** `PROMPT_HARD_CEILING_TOKENS = 180000` with 2,000 margin (`prompt_engine.py:72-75, 236-390`): up to 3 rounds of proportional truncation at the last `>` before the cut, refusing to go below 20,000 element tokens; then drop per-template fallback inputs (for `extract-action`: `action_history`, `navigation_payload_str`); then trim without a floor; else raise `SkyvernContextWindowExceededError`.
7. **Screenshot coupling:** if the trimmed tree alone is over 100k approximate tokens (4 chars/token), only 1 screenshot is taken (`scraper.py:816-821`).

Token counting uses tiktoken's `gpt-4o` encoding with a chars/4 fallback (`skyvern/utils/token_counter.py`), so the budget is approximate for Claude (inferred: about 10-20% off).

## 7. Iframes

Driven from Python with Playwright (`scraper.py:974-1166`):

- Main frame first (`frame_name="main.frame"`, `frame_index=0`). Then `get_all_children_frames` BFS over `page.main_frame.child_frames` (`974-983`), optional `scrape_exclude` filter which can drop a frame and leave a non-interactable placeholder node (e.g. a cross-origin captcha) in the tree only (`986-1020`, `1161-1164`).
- Each frame gets a stable `frame_index` from `context.frame_index_map` (`1143-1147`).
- For each frame (`add_frame_interactable_elements`, `1034-1111`): get the `<iframe>` element via `frame.frame_element()`, skip it if not visible (evaluating in an invisible iframe can hang), read its `unique_id` in the **parent** context, run `buildTreeFromBody(frame_name=<iframe unique_id>, frame_index)` inside the child frame, then attach the child tree as the iframe node's `children` in both the flat and nested structures (`1086-1105`; comment explains raw-CDP JSON round-trips break object aliasing).
- At action time `resolve_locator` (`skyvern/webeye/utils/dom.py:166-232`) walks `element.frame` up through `id_to_element_dict` to build the iframe chain, then descends with `query_selector("[unique_id='F']").content_frame()` and `frame_locator(...)`, capped by `MAX_FRAME_CHAIN_DEPTH`.
- Cross-origin (OOPIF) frames work because Playwright/CDP attaches to them (inferred from use of `child_frames`; no special casing in the scraper).

**CDP/Playwright dependency:** hard for enumeration, the frame-to-element mapping, and per-frame evaluation.
**Native path:** WKWebView can evaluate in a given `WKFrameInfo` (`evaluateJavaScript(_:in:in:)` / `callAsyncJavaScript(_:arguments:in:in:)`), and with a `WKUserScript` injected into all frames each frame can run `buildTreeFromBody` on its own. The missing piece is "which `<iframe>` element is this frame?". Options (inferred designs): (a) same-origin frames: `window.frameElement.getAttribute("unique_id")` from inside the child; (b) cross-origin: the parent stamps each iframe with a nonce and `postMessage`s it to `iframe.contentWindow` with a private channel; the child's content-world listener records it and returns it with its tree; (c) fallback: match `WKFrameInfo.request.url` plus document order. Frame discovery: enumerate frames via `WKFrameInfo` delivered to a script message handler registered by the all-frames user script (each frame "checks in" on load). Then reproduce the grafting logic in Rust exactly as `_attach_frame_subtree` does. Action-time resolution becomes "evaluate in frame F: querySelector('[unique_id=X]')", with no frame-locator chain needed because we hold the frame handle directly.

## 8. Shadow DOM

- Open shadow roots are traversed inline: `element.shadowRoot` children are processed after light-DOM children with the same parent id, so they appear as children of the host (`domUtils.js:2717-2721, 2842-2846`). Hosts are always kept (`2738-2739`).
- Each shadow element records `shadowHost = <host unique_id>` (`2541-2545`); lookup is `host.shadowRoot.querySelector('[unique_id=X]')` (`1873-1892`). This supports one level only (inferred: a nested shadow root inside a shadow root resolves only if its host is directly in light DOM). Playwright CSS selectors pierce open shadow roots, so action-time locators work at any depth.
- Shadow text nodes directly under a shadow root are folded into the host's text (`1827-1846`).
- Incremental observation also observes the shadow root of the clicked element (`3929-3938`); `getIncrementElements` skips refreshing shadow elements (FIXME at `4032-4035`).
- Closed shadow roots are invisible (no CDP pierce is used).

**CDP dependency:** none for scraping; Playwright's piercing selector is used only for actions.
**Native path:** identical scraping. For actions, implement a small piercing `querySelectorDeep` (walk shadow roots) in the content world. For closed roots, a document-start main-world script can wrap `Element.prototype.attachShadow` to record roots in a WeakMap keyed by host and expose them to the isolated world via a DOM attribute on the host plus a message (inferred; this is something CDP-free Misty could do *better* than Skyvern).

## 9. Selects, dropdowns, date pickers

1. **Native `<select>`:** options inlined in the tree; the model returns `{label, index, value}` (`extract-action.j2:40-43`) and Python uses Playwright `select_option`. Native path: set `select.value`/`selectedIndex` and dispatch `input` + `change` in JS (no CDP needed).
2. **Custom dropdowns** are surfaced as `<select>` via `isSelectable` (section 4). Selection is a multi-step loop in `skyvern/webeye/actions/handler.py`: before clicking the trigger, `IncrementalScrapePage.start_listen_dom_increment` starts a `MutationObserver` on `document.body` (and the trigger's shadow root) (`domUtils.js:3908-3939`, `handler.py:8038`); the click happens; `getIncrementElements` (`domUtils.js:3972-4141`) returns only the **new or revealed** subtrees (childList additions, `hidden` removed, `style` no longer `display:none`, class changes away from `hide|invisible|closed` or to `open|active`, plus any mutation on select/listbox/option nodes, `3761-3865`), deduplicated by DOM depth and re-built from live DOM. Each parse waits a `requestAnimationFrame` and sleeps 300 ms for the first 100 parsed nodes to let animations finish (`3676-3699`). The new subtree is shown to the LLM with `custom-select.j2` ("the matching element can only be in the emerging elements"), which returns the option id or a value to type into a search box; multi-level selections (cascades, date pickers) repeat with a `select_history`. `auto-completion-*.j2` handle type-ahead comboboxes.
3. **Virtualized lists:** `scrollNearestScrollableContainer` (`domUtils.js:3291-3442`) scrolls an option list by 85% of its viewport per call (so one row overlaps), searching breadth-first for the inner scroll viewport (depth <= 5, <= 200 nodes), else nearest scrollable ancestor, else sibling, else reports `"page"` so Python uses mouse wheel (comment: native wheel triggers IntersectionObserver more reliably).
4. **Open popups vs screenshots:** `getOpenAriaPopupTrigger` (`927-964`) detects an `aria-expanded="true"` combobox/haspopup trigger whose controlled target actually paints area; the scraper then suppresses scrolling screenshots so a portal popup that dismisses on scroll stays open (`scraper.py:823-838`).
5. **Date pickers:** heuristics recognize bootstrap-datepicker navigation (`1128-1178`), react-datepicker disabled days (`1790-1796`), Angular Material datepicker inputs (`1677-1689`), and `button[data-testid*=date]` as selectable (`1503-1512`). The action schema carries `is_date_related` and `date_format` (`extract-action.j2:58-59`) and `check-date-format.j2` validates typed dates; a date-related custom-select cascade has a wall-clock budget (`handler.py:435`).

**CDP dependency:** none for detection and observation; clicks use Playwright input. Native: the observer and incremental tree are pure JS; clicks become native trusted events posted to the view at the element's center.

## 10. Screenshots

- `take_split_screenshots` (`page.py:2973-2998`) -> `_scrolling_screenshots_helper` (`page.py:1575-1666`). If `isWindowScrollable()` (document taller than viewport and neither `body` nor `html` has `overflow:hidden`, `domUtils.js:3268-3289`): `window.scroll(0,0)`, then loop: capture the **viewport**, `scrollBy(innerHeight - 200)` (200 px overlap in DETAILED mode), stop when the scroll position moves 25 px or less or `MAX_NUM_SCREENSHOTS = 10` is reached (`skyvern/config.py:218`). If `scrollHeight` changes mid-loop (lazy loading), the element tree is rebuilt so new nodes get ids (`page.py:1601-1610`). Afterwards scroll to top, wait for animations, and the scraper restores the original x/y (`scraper.py:840-889`).
- Capture primitive: Playwright `page.screenshot(animations="disabled")` with a 20 s timeout (`skyvern/config.py:162`), a raw-CDP `Page.captureScreenshot` rescue on timeout, and a retry with animations allowed (`page.py:1091-1229`). The cursor overlay is hidden during capture.
- Full-page images for artifacts are stitched with PIL by scroll position, cropping the overlap (`page.py:1669-1722`); the LLM receives the list of viewport images.
- Before the LLM call, screenshots are resized to an Anthropic-CUA-style target (1024x768, 1280x800, 1366x768) when the aspect ratio matches within 0.02 and the window is larger (`skyvern/utils/image_resizer.py:12-50`, `api_handler_factory.py:4039`).
- CUA engines get exactly one unscrolled screenshot (`skyvern/forge/agent.py:8559-8562`).
- **Bounding boxes:** `drawBoundingBoxes` (`domUtils.js:2930-2944`) grouped overlapping element rects with a quadtree (`256-361`, `2978-3068`), drew a 2px blue box per group and a label equal to the group's first interactable `unique_id` (`3088-3187`). This Set-of-Marks overlay is **deprecated**: every caller passes `draw_boxes=False` (`agent.py:8556-8558`, `scraper.py:359-362`). Current Skyvern relies on the text tree for grounding and on screenshots only for visual context (red error text, popups: `extract-action.j2:9-10`).

**CDP dependency:** partial. The scroll loop is pure JS; the capture is Playwright/CDP.
**Native path:** `WKWebView.takeSnapshot(with:)` with `WKSnapshotConfiguration.rect = nil` and `afterScreenUpdates = true` gives the current viewport; drive the same JS scroll loop between snapshots. A snapshot of an offscreen/hidden webview may be blank or stale (inferred), so the agent view must be in a window (can be off-screen-positioned). Disable animations by injecting a `*{animation:none!important;transition:none!important}` style only during capture (inferred replacement for `animations="disabled"`). If a Set-of-Marks variant is ever wanted, draw boxes in Rust onto the snapshot from rects returned by JS rather than mutating the page as Skyvern did.

## 11. Readiness waits

- Default: `wait_for_load_state("load")` then poll `isAnimationFinished()` (`document.getAnimations({subtree:true})` all finished, `domUtils.js:4143-4152`) every 100 ms for up to 3 s; timeouts are ignored (`page.py:3479-3517`).
- Optional page-ready mode (`page.py:3519-3600`): loading indicators gone (selector list of spinner/loading/skeleton/progress/shimmer classes and `aria-busy`, polled every 100 ms, 5 s; `page.py:595-625`), then Playwright `networkidle` (3 s), then DOM stable for 300 ms by MutationObserver (3 s) (`page.py:3630-3689`).
- Empty tree: wait and retry; then retry after 3 s; then `page.goto(page.url)` (not reload, to avoid POST resubmit) and retry (`scraper.py:410-427`, `777-786`).
- Canvas apps (Flutter web, Uno WASM) get their accessibility semantics switched on by clicking the framework's hidden "enable accessibility" placeholder, 3 s budget (`skyvern/webeye/utils/flutter_semantics.py`).

**Native:** `load` comes from `WKNavigationDelegate.didFinish`; animations/indicators/DOM-stability probes are pure JS; network idle needs a main-world `fetch`/`XMLHttpRequest` in-flight counter plus `PerformanceObserver('resource')` (inferred), since there is no network interception.

## 12. Portability matrix

| Piece | Where | CDP/PW dependency | Native webview path |
|---|---|---|---|
| DFS, visibility, interactability, ids, element objects, text dedupe | `domUtils.js:363-2928` | none | Content world, as is; set `browserNameForWorkarounds="webkit"` |
| jQuery/Angular/ASPx click detection | `domUtils.js:410, 1445-1462, 1618-1642` | none, but needs main world | Main-world helper stamps a DOM marker |
| Hover-cursor stylesheet map | `domUtils.js:3478-3589` | none | As is |
| Incremental MutationObserver tree | `domUtils.js:3619-4141` | none | As is |
| Virtualized-list scrolling, popup detection | `domUtils.js:768-964, 3291-3442` | none | As is |
| Occlusion check | `domUtils.js:644-742` | none | As is (already has WebKit workaround) |
| Frame enumeration / iframe mapping / per-frame eval | `scraper.py:974-1111`, `dom.py:166-232` | hard | WKFrameInfo + all-frames user script + nonce handshake |
| Trim / serialize / token budget | `scraper.py:1417-1536`, `scraped_page.py`, `prompt_engine.py` | none (Python) | Port to Rust/TS |
| SVG/CSS-shape naming | `agent_functions.py:680-1049` | partial (locator, element screenshot) | Snapshot rect from JS bounds; engine call via Misty engine proxy |
| Viewport screenshots + scroll loop | `page.py:1091-1666` | partial (capture only) | `takeSnapshot` + same JS loop |
| networkidle | `page.py:3566-3580` | hard | Main-world request counter |
| Destination facts | `domUtils.js:2044-2209` | none | Optional, for the permissions gate |

## 13. Licensing

- The repository has a single `LICENSE` at the root: GNU AGPL-3.0. A search found no other LICENSE files outside `node_modules` and no per-file SPDX headers in `skyvern/webeye/`, `skyvern/utils/` or `skyvern/forge/`. Everything recommended here is AGPL-3.0 and compatible with Misty's AGPL-3.0, with the usual obligations (preserve notices, state changes, offer source to network users).
- `domUtils.js` embeds code marked "from playwright" with upstream permalinks (`domUtils.js:363-708`: `getElementComputedStyle`, `isElementStyleVisibilityVisible`, `isElementVisible`, `isVisibleTextNode`, `parentElementOrShadowHost`, `enclosingShadowRootOrDocument`, `expectHitTarget`). Playwright is Apache-2.0, so a derived copy should keep those attributions and add Playwright's notice to Misty's `NOTICE`.
- The `Rect`/`DomUtils.getVisibleClientRect`/`generateHintStrings` code (`domUtils.js:29-254, 3070-3086`) closely resembles Vimium (MIT): the `NOTE(mrmr1993)` comment names a Vimium contributor and `"sadfjklewcmpgh"` is a Vimium hint alphabet (inferred). Add a Vimium MIT notice if we copy those parts; the hint-string code is dead anyway.

## 14. What Misty should take from this

1. **Port `domUtils.js` nearly wholesale into a WKContentWorld**, keeping its decision functions (`isElementVisible`, `isInteractable` and its library special cases, `isSelectable`, `getElementText`, `trimDuplicatedText`, `buildElementObject` normalization, OTP/password masking, the incremental observer, `scrollNearestScrollableContainer`, `getOpenAriaPopupTrigger`). This is years of hand-tuned, site-specific knowledge, it needs no CDP, and it is AGPL-compatible.
2. **Adopt the representation format:** pseudo-HTML of kept nodes only, short base-62 ids on interactables only, whitelisted attributes, custom dropdowns renamed to `<select>`, inline `<option index>`, hashed long hrefs, `[icon]` for PUA glyphs, live `value`/`checked` from DOM properties. For Claude-class models, HTML-ish text is more compact than a JSON AX tree and preserves table/form structure. CDP's AX tree is not needed to get this.
3. **Use incremental (diff) trees after actions** that open menus: return only "what appeared" to the model. This fixes most dropdown and date-picker failures and is cheap.
4. **Implement the staged token budget**, with a Claude tokenizer estimate instead of tiktoken, and keep the "popups first before truncation" rule.
5. **Frames are where we need new engineering**: an all-frames user script, a frame check-in registry keyed by `WKFrameInfo`, and a nonce handshake to bind cross-origin frames to their `<iframe>` node.
6. **Things to do better than Skyvern:** run in an isolated world (no tamperable exports); add a viewport-aware flag per element (Skyvern only checks X), since the model benefits from knowing what is on screen now; capture closed shadow roots via an `attachShadow` hook; compute occlusion for interactables at scrape time with `elementsFromPoint` (cheap, already implemented as `expectHitTarget`) and mark `occluded` instead of discovering it at click time.
7. Skip the deprecated bounding-box overlay and the SVG-to-LLM conversion at first. The latter costs extra model calls per page; a cheaper start is `aria-label`/`title`/`<title>` extraction plus a small static icon dictionary, keeping LLM naming (through the Misty engine proxy) for later.
