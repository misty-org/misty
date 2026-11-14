# 30. Misty's current browser harness, read from source

Scope: how Misty's agents browse today, read from the code (nothing was run). It covers the page runtime in
`misty-browser-harness/crates/page-runtime/js` and the Rust and TypeScript layers in `misty/` around it. It is
written to sit beside the Skyvern and browser-use reports, so each mechanism notes its CDP dependency and its
license. Paths starting `js/` are under `misty-browser-harness/crates/page-runtime/`. Paths starting
`src-tauri/` or `src/` are under `misty/`. Anything I inferred rather than read is marked **(inferred)**.

License of everything here: AGPL-3.0-or-later, plus the NOTICE §7(b) attribution term
(`misty-browser-harness/LICENSE`, `misty-browser-harness/NOTICE`, `misty/LICENSE`, `misty/NOTICE` lines 7-13).
`js/page_core.js:3-6` says the role and accessible-name rules follow Playwright's aria snapshot, which is Apache-2.0,
"design only; no code copied".

---

## 1. The call path, end to end

An engine call such as `browser_steps` goes through these layers:

1. **Engine → MCP.** `src-tauri/features/engines/mcp.rs` serves JSON-RPC over HTTP on `127.0.0.1:47600`, or a
   random port if that one is taken (`port`, 391-415). Each run gets a bearer token (`servers_for`, 426-437). The
   tools come from `catalog.json`, filtered to `SPACE_TOOLS` and `BROWSER_TOOLS` (38-67), with `.` renamed to `_`
   (`wire_name`, 106-108). Browser tools are offered only when the person attached the browser to the message
   (`Caller.browser`, from the run request's `browser` flag, 287-307). `browser.act` and `browser.extract` are
   left out on purpose, because "the engine is the model here" (50-52).
2. **Journal and gate.** `call_tool` (309-346) hands the call to `AppToolHost::call`
   (`src-tauri/features/agents/run_control/local_tools.rs:329-383`). That function:
   - writes a journal row (`ToolJournal::begin`), so that after a restart a write is never repeated blindly
     (`Begun::Interrupted` returns "uncertain", 351);
   - runs the policy gate (`tool_gate::admit`, `tool_gate.rs:167-190`);
   - emits `misty://agent-tool-call` to the person's app window and waits up to 20 min, checking every 2 s that
     the window is still alive (`ask`, 274-315).
3. **Renderer job.** The app window (TypeScript) runs the call as a "device job":
   `src/features/agents/runs/jobs/browserJobRun.ts:44-158`. It wakes a sleeping tab, registers a grant for that
   one operation, calls `invoke("browser_agent_execute_bounded")`, and revokes the grant afterwards (147-153). For
   a `browser.snapshot` or `browser.find` that comes back `about:blank` on a tab that last showed a real page, it
   retries after 1.5 s, then re-navigates to the remembered URL (51-67).
4. **Native command.** `execute_agent_request` (`src-tauri/features/browser/agent_pages/agent.rs:22-185`) checks:
   - the task scope (`authorize_scope`);
   - the agent's grant (`resolve_agent_webview`);
   - for acting operations, the site block list (53-86).

   It then dispatches page-layer operations to `page_agent::execute`
   (`agent_pages/page_agent/execute.rs:4-127`). It handles `browser.navigate`, `browser.visual` and the legacy
   `browser.inspect` path itself.
5. **Page runtime.** `page_agent::call_at` (`page_agent/mod.rs:94-157`) builds a function body: the whole
   `RUNTIME` string, about 114 KB of JS concatenated in `crates/page-runtime/src/lib.rs:13-25`, followed by
   `return JSON.stringify(await page.call(op, args))`. It runs that body through
   `content_world::evaluate_in_content_world` or `evaluate_in_frame`. On macOS that is
   `callAsyncJavaScript:arguments:inFrame:inContentWorld:` in the named world `misty-agent-page`, with a 10 s
   timeout (`src-tauri/features/browser/pages/content_world.rs:96-172`, the call at 159 and the timeout at 168).
   The runtime installs itself idempotently on `globalThis.__mistyAgentPageV1` (`js/page_core.js:7-14`). Its state
   (refs, ids, semantic hash) lives in that world for the life of the document.
6. **Native input.** Clicks, keys, typing, wheel and hover are AppKit events posted straight to the WKWebView's
   hit-tested subview (`src-tauri/features/browser/input/macos/native_action.rs`). WebKitGTK and Windows have
   their own dispatchers (`input/native_input.rs:158-175`).

**Observation:** the full 114 KB runtime is re-sent on every call. That includes every 250 ms poll of
`waitCheck` (`execute.rs:146-167`) and every `observe`/`settle` between steps. WebKit has to parse it each time.
The cost is likely real but unmeasured **(inferred)**. A pinned `WKUserScript` injected once into the world at
document start, or a hash check (`if (!globalThis.__mistyAgentPageV1)`), would remove it.

There is a second, older path: `browser.inspect` and `browser.visual` use
`src-tauri/features/browser/kiri_link/scripts/inspection_*.js`. These run in the **page world** via `eval_json`.
Their refs look like `element-<generation>-<index>` and are stored in `BrowserSession.element_targets`
(`agent_pages/agent_actions.rs:102-120`). `browser.interact` (`input/interact.rs`) uses them for visual-point clicks.
Engines see only `browser.visual` from this path.

---

## 2. The tool catalog (browser and screen tools)

Source: `src-tauri/features/agents/runs/local_prompt/catalog.json` (64 tools in total). Under "Engines", **yes**
means the tool is in the engine MCP `BROWSER_TOOLS` list (`mcp.rs:53-67`). Risk, layer and locality come from
each tool's `_meta`.

| Tool | Engines | Semantics (paraphrased from the description and implementation) |
|---|---|---|
| `screen.open` | yes (rewritten) | Opens a tab owned by the run in the person's window, optionally at a URL, and returns a `scopeId`. Engines get a custom description saying it "carries their signed-in sites" (`mcp.rs:69-74`), and `target` is removed so engines never get the desktop or the person's tabs (120-135, 220-225). A run can open up to 32 tabs. A repeated URL returns the existing tab. |
| `screen.close` | yes | Closes one of the run's own tabs. The run's first tab cannot be closed. |
| `screen.look` | no | Captures the person's screen and ends the response. |
| `browser.snapshot` | yes | Accessibility-tree text with refs (§3). Args: `maxChars` 2000-60000 (default 24000, `execute.rs:36-39`) and `scopeRef`. Before a full snapshot it declines a cookie banner and splices in cross-origin frames (`execute.rs:45-60`). |
| `browser.find` | yes | Ranks actionable elements against plain words and returns up to 20 snapshot lines. The top match is scrolled into view (`js/page_tree.js:321-353`). |
| `browser.wait_for` | yes | Polls `waitCheck` every 250 ms for `text`, `textGone` or `urlIncludes`. Default 8 s, maximum 20 s (`execute.rs:129-167`). Frames count for `text`. No model calls. |
| `browser.navigate` | yes | Marks the current document, navigates, waits for the new document to land, then returns a full snapshot (`agent.rs:105-153`, `navigation.rs:53-122`). |
| `browser.steps` | yes | 1-10 steps by ref (§5). They stop on failure, navigation or a new dialog, and the result includes a 12000-char snapshot. |
| `browser.fill_form` | yes | 1-30 `{ref, value}` pairs turned into fill, check, uncheck or select steps (`steps.rs:199-258`). It never submits. |
| `browser.skill` | yes | Runs a pattern skill or app skill that the snapshot listed (§8). Up to 4 phases. |
| `browser.visual` | yes | The legacy inspection plus a viewport image: a 640 px JPEG via `takeSnapshot` (`agent/operations.rs:7-57`, `pages/macos/capture.rs`). Points are normalized to 0..1. |
| `browser.downloads.list` | yes | The session's download records, filtered by task (`agent.rs:158-182`). |
| `browser.run` | yes | A JavaScript program in a QuickJS-WASM sandbox in the renderer (`src/features/agents/programs/sandbox.ts`, 64 MB memory, deadline interrupt). It drives the run's tabs with `openTab`, `read`, `text`, `find`, `click`, `type`, `fill`, `select`, `check`, `hover`, `press`, `scroll`, `scrollTo`, `waitFor`, `keep`, `close`, `note`, with a 2 min limit and 80 page calls (`programs/pageHost.ts:31`). A target can be a ref, a `{role,name}` locator, or words looked up with `find` (`programs/pageTarget.ts`). A failure from a stale ref is retried once after a re-read (`pageHost.ts:151-164`). |
| `browser.request_user_action` | yes | Hands control to the person for `sign_in`, `account_confirmation`, `challenge`, `open_target` or `review`, and resumes when they continue. |
| `browser.act` | **no** | Misty's own on-device screen agent works toward a visual goal from screenshots for about 4 minutes. Not offered to engines. |
| `browser.extract` | **no** | Page markdown (120k chars) plus an instruction and a JSON schema, sent to the *device model* (`browserJobRun.ts:73-94`). Engines lose this tool and get the markdown only indirectly, through `browser.run`'s `text()`. |
| `browser.inspect`, `browser.upload`, `browser.workspace.visual` | no | The legacy inspect, a file upload by ref (attachment or download id), and desktop capture. |

Engines therefore cannot upload files (`browser.upload` is not in `BROWSER_TOOLS`). That is a gap for benchmark
tasks that attach files **(inferred)**.

---

## 3. Snapshot format

`P.build` (`js/page_tree.js:64-165`) walks the composed tree. It goes into open shadow roots and slot-assigned
nodes (83-84), and into same-origin iframe documents (100-117). Limits:

- `MAX_SCAN` = 25000 elements (5);
- `maxRefs` = 800 by default (65);
- a `<select>` lists at most 40 options (148-153).

Each element is handled as follows:

- **Skipped** by `hiddenSelf` (`js/page_core.js:137-157`): hidden, inert, `aria-hidden`, `display:none`, and a
  negative-z-index positioned layer whose centre `elementFromPoint` shows to be covered by something else.
  `visibility:hidden` keeps the element's subtree but drops its text.
- **Given a role** by `P.role`: explicit ARIA first, then implicit HTML roles (`page_core.js:41-76`). An element
  with no role becomes `clickable` when it is tabbable, has an `onclick` attribute, or has `cursor:pointer` while
  its parent does not (`page_tree.js:120-126`). That last check is a cheap stand-in for the "paint/interactive"
  heuristics of DOM-based harnesses.
- **Marked scrollable** when `overflow` is auto/scroll/overlay and `scrollHeight > clientHeight+1` (127-129).
- **Becomes a line** only when it is interactive, scrollable, or in `STRUCTURE`: landmarks, lists, table parts,
  headings, img, status, iframe and similar (7-10). Other elements pass their children through.
- **Leaf** roles (button, link, textbox and so on) do not list their children when they have a name (12-13, 154).
- **Name**: a simplified accname. In order: `aria-labelledby`, `aria-label`, then label/title/placeholder/name
  for form controls, then alt, then content for name-from-content roles. Clipped to 160 chars
  (`page_core.js:106-134`).
- **States**: level, checked/mixed, pressed, expanded/collapsed, selected, current, disabled, required, invalid,
  readonly, multiline (`page_tree.js:20-37`). The value of an input, select or contenteditable is clipped to 300
  (39-52). Link URLs are shown relative to the page's origin when they share it (54-61).
- **Secret fields** (password, one-time-code, card number, CVC; `page_core.js:170-179`) get no ref and no value,
  only the prop `password — only the person may enter it` (`page_tree.js:138`).

Lines are rendered as Playwright-style YAML (`P.line`, 168-176):

```
- button "Search" [ref=e12]
- textbox "Email" [required] [ref=e13]: "a@b.c"
- link "Pricing" [ref=e14] [url=/pricing]
```

Budget handling:

- **Menu cap.** When the page overflows `maxChars`, each `navigation`, `banner`, `contentinfo`, `complementary`
  or `menubar` subtree is capped at `min(1500, maxChars/8)` chars. It then gets a line such as
  "(N more items in this navigation left out …; browser_find searches them)" (182-231). Without this, header and
  sidebar chrome used up the budget on long pages.
- **Header notes.** The tree is prefixed with notes:
  - a covering popup with its close ref, or a hint to press Escape (`page_tree.js:289-298`);
  - an error page ("404", "page not found" and similar), when the body has under 6000 chars (301-308);
  - in `navigation.rs:107-116`, "still on the old page" or "bot check did not clear".
- **File inputs.** Hidden `input[type=file]` elements, up to 10, are appended as a group so the agent can reach
  upload buttons the site drew itself (277-285).

Result fields: `documentId`, `url`, `title`, `tree`, `truncated`, `refCount`, `dialogs` (up to 5 open dialog
names), `focused`, `skills`, and `scroll {y, height, viewport}` (309-317). On the Rust side `contentTrust:
"untrusted-web-page"` and `target` are added (`execute.rs:121-122`).

What it does **not** have, compared with CDP-based harnesses:

- no bounding boxes;
- no paint-order or occlusion filtering beyond `elementFromPoint` at action time;
- no "new since last step" marker;
- no in-viewport/off-viewport split; only `scroll` numbers are given.

`browser.extract`/`markdown` (`page_tree.js:408-440`) reuses the same tree, skipping controls. It turns headings,
links, list items and table rows into Markdown, and adds `collapsedText`: text inside closed `<details>` and
`aria-expanded=false` panels outside menus and dialogs (377-405).

---

## 4. Refs: identity, lifetime and staleness

- **Assignment.** `P.register` (`page_core.js:195-203`) keeps a `WeakMap<Element, "eN">`, so **the same element
  keeps the same ref across snapshots**. Each registration records `{el, frames: frameChain(el), fp:
  fingerprint(el)}`. The fingerprint is `[tagName, role, name[:80], type, href]` (181).
- **documentId** is a UUID the Rust side supplies (`candidateId`). The runtime keeps the first one per document
  (`page_tree.js:260`), so it changes only when the document changes. A new document means a fresh world state,
  and a document swap inside one world resets the refs (`page_core.js:10-13`).
- **Resolution** (`P.resolve`, 213-230) fails as `browser_snapshot_stale` when any of these holds:
  - the documentId differs;
  - a provider "semantic" probe (account or reviewed content; `kiri_link/scripts/semantic_snapshot.js`, which has
    only a Todoist adapter today) changed;
  - the ref is unknown;
  - the element is disconnected, or a frame in its chain swapped its document;
  - the fingerprint changed.

  A hidden element returns `browser_target_hidden`, except file inputs.
- **Sweep.** `P.sweep` drops disconnected refs before each snapshot or find (`page_tree.js:233-235`).
- **Cross-origin frame refs** are drawn from per-slot ranges: slot *n* starts at *n*×1,000,000+1 (`REF_RANGE`,
  `SLOTS`=9, `page_agent/frames.rs:28-31`). `frame_of` routes a ref by its number (104-113).
- **Locators** `{role, name, index}`, where index counts same-role, same-name refs earlier in document order
  (`page_core.js:236-248`), are returned with every step outcome (`step.rs:144-171`). A step may name a locator
  instead of a ref (`steps.rs:93-105`; the catalog says "Saved workflow replays only"), and `P.locate` finds it
  again (`js/page_actions.js:281-292`). This is the only self-healing or replay mechanism today.

Lifetime summary: a ref is valid until navigation, until its element is removed or its name changes, or until the
semantic probe changes. It is not invalidated by new snapshots.

---

## 5. Actions (`browser.steps`)

Step shape: `steps.rs:21-52`. Validation happens before anything runs (76-179). The limits are: text up to 20000
and no NUL; select 1-50 values; scroll amount 0.1-10 screens; `wait_for` 100-20000 ms; left or right button;
`clickCount` 1-2. Keys are restricted by `native_input::validate` (`input/native_input.rs:24-108`): named keys
plus single printable characters, and Cmd/Ctrl shortcuts only for `a` and `z` (select all, undo, redo). An agent
therefore cannot close tabs or reach the clipboard.

Batch rules, from `run_batch` (`page_agent/batch.rs:76-195`):

- Re-authorize the task scope and grant before every step (92-99), so Stop, take-over and revocation apply
  between steps.
- After each non-wait step, call `settle` with `quietMs` 150 and `maxMs` 1500. It is a MutationObserver quiet
  window (`js/page_read.js:35-45`).
- Stop when the URL or documentId changed, or when the number of dialogs went up (166-179).
- A stale error before anything was dispatched becomes a tool error. After a dispatch, everything is reported per
  step (112-148).
- If nothing reached the page, return `status: failure`, `attempted: false` (184-193).
- Then `after_snapshot`: 12000 chars, plus frames (22-44).

One step runs as follows (`step.rs:114-173`, `step/checked.rs:6-294`):

1. **Prepare** (`js/page_actions.js:34-103`). Resolve the ref and reject disabled controls. If the element is
   outside the viewport, call `scrollIntoView({block:center, behavior:instant})`. For click, check, uncheck and
   hover, probe **5 points** on the rect (centre, then 4 inset edge points with inset `min(max(2, size/4), 8)`)
   using a shadow-piercing `elementFromPoint` (8-16). A point is good when the element hit is the target, its
   descendant or ancestor, or its `<label>` (22-23). The point is translated through the frame chain to the top
   viewport and re-checked there (82-91). It is returned as a *fraction of the viewport* (93). A zero-size
   control with a label is retried on the label (63-67). A covered target fails with `browser_target_covered` and
   includes the link's `href` (99-102).
2. **Recover from cover** (`step.rs:65-93`). On `browser_target_covered`, call `dismissPopup` and prepare again.
   If the page had to scroll, sleep 120 ms and measure again. If the target is still covered, a click on a link
   becomes `location.assign(href)` (`checked.rs:49-66`).
3. **Consequence gate** (§9).
4. **Input.** In the top document, input is native when possible. Inside a cross-origin frame it is always the
   script path (`checked.rs:17-22`, "Native input lands at a point in the top document").
   - **click/check/uncheck**: check/uncheck first read the current state and return `unchanged` when nothing would
     change. Then a native click at the fraction point. The fallback is script `pointerover…mousemove`, then
     `pointerdown/mousedown/pointerup/mouseup/click` with the right `detail`, plus `dblclick` on the second press
     and `contextmenu` for the right button (`page_actions.js:114-132, 306-318`). Before a script click an agent
     cursor overlay glides to the point for 320 ms (`CURSOR_GLIDE_MS`, `step.rs:96`).
   - **fill**: `execCommand("insertText")` after `select()`, so beforeinput and input events fire. If the value did
     not stick, it falls back to the native value setter plus `InputEvent`/`change` (`page_actions.js:155-166`).
     Contenteditable gets a select-all range plus `insertText` (168-180). Date, colour and range inputs get the
     value setter (145-154). If the result reports `retained:false` (canvas editors keep their own model), Rust
     re-types it natively with Cmd-A then `type`, for text up to 16000 chars (`checked.rs:243-275`).
   - **type**: focus by script, native Cmd-A, then native `type`. On macOS that is **one
     `insertText:replacementRange:` call with the whole string** on the first responder
     (`input/macos/native_action.rs:147-155`), not one keystroke per character. With `submit`, a native Enter
     follows. If native input is unavailable it falls back to `fill`.
   - **select**: native `<select>` only, matched by value, exact text, then case-insensitive text. An input with
     suggestions takes the option as text. Anything else is told to use `pickers.choose`
     (`page_actions.js:184-204`).
   - **hover**: a native `MouseMoved` (macOS and Linux) *and* script hover events, then 150 ms
     (`checked.rs:159-171`).
   - **key**: focus the ref, then native `keyDown`/`doCommandBySelector` (`native_action.rs:252-318`). The fallback
     is script `KeyboardEvent`s, which are untrusted.
   - **scroll**: a page scroll with no ref becomes a native wheel event (CGEvent scroll wheel,
     `native_action.rs:163`) of `amount×viewport` px, clamped to ±2000, then 300 ms. A ref, a text, or
     `into_view` uses script `scrollBy` of 0.85 screen on the nearest scrollable ancestor, or `scrollIntoView` of
     a text match (`page_actions.js:247-276`).
   - **upload**: base64 bytes become a `File` in a `DataTransfer` assigned to `input.files`, plus input/change
     events. It reports `websiteUploadVerified:false` (348-361).
   - **wait_for**: the same poller as `browser.wait_for`.
5. **Native safety checks before input lands** (macOS `dispatch`, `native_input.rs:176-245`). These run on the main
   thread right before the event:
   - the task is still authorized and the grant is valid;
   - the session's `snapshot_generation` is unchanged (it is bumped on every load start,
     `pages/create/events.rs:60-66`);
   - the origin is the same as at prepare time;
   - the window is visible and not miniaturized (`native_action.rs:79-83`);
   - the viewport is the same size as when measured, within 2 px (89-93).

   An invisible view falls back to the script path (`step.rs:51-52`). Events go to the view's own hit-tested
   subview, never through `NSApp.sendEvent` or `CGEventPost` (`native_action.rs:1-5`).

No action is followed by a check that it took effect, except `retained` for fills, `checked` state, `scrolled` and
`atEnd`. A native click reports `verified:false` (`native_action.rs:23-28`).

---

## 6. Waits, navigation and loads

- `waitCheck` (`js/page_read.js:21-32`) checks `body.innerText` for the text or textGone (lower-cased substring),
  or the URL for `urlIncludes`. It also reports `readyState`, the navigation `mark`, and `challenge`: the title is
  "Just a moment", or a body under 3000 chars matches a Cloudflare-style regex (18).
- `settle` waits for a MutationObserver quiet window: `quietMs` 50-1000, `maxMs` up to 5000.
- `first_load` (`navigation.rs:7-32`) is for a new tab. It waits until the tab leaves about:blank and
  `readyState=complete`, waits out a bot check up to 20 s, and gives up at 15 s (blank) or 25 s.
- `landed` (`navigation.rs:53-122`) runs after `browser.navigate`. A document "arrived" when its `mark` token
  differs from the token set by `mark_document` before navigating, or when only the fragment changed. It polls
  every 300 ms, waits out a challenge for up to 20 s, and gives up at 15 s (not arrived) or 25 s. Then it settles
  (400/3000), declines consent, and takes a full snapshot with a note when the page did not arrive or the
  challenge persisted.
- There is **no network-idle signal** (no CDP `Network.*`). Readiness is `readyState` plus DOM quiet. A
  `WKNavigationDelegate` `didFinish` is what Tauri's `on_page_load` uses (`create/events.rs`), but the waits do
  not consult it; they poll the page **(inferred)**.
- Agent tabs **sleep** when idle: the webview is closed and its address remembered, then it is woken on the next
  job (`src/features/agents/tabs/agentTabs.ts:19-30`, `browserJobRun.ts:101-103`). In-page state (form contents,
  SPA state, sessionStorage tied to the view) is therefore lost between idle periods **(inferred)**.

---

## 7. Frames

- **Same-origin frames** are walked inline by `P.build`. The refs belong to the top document's world and actions
  translate coordinates through the chain (`page_actions.js:82-91`). An editor iframe whose body is editable
  (CKEditor, TinyMCE) has its body listed (`page_tree.js:104-106`).
- **Cross-origin frames.** `agent_pages/frames.rs:25-37` installs a `WKUserScript` at document start, in every
  frame (`forMainFrameOnly:false`), in the private world `misty-frames`. Each cross-origin frame posts
  `{top,url}` to a world-scoped message handler (155-185). The handler keeps the `WKFrameInfo` from
  `message.frameInfo()`: up to 24 per view, newest last, with URLs deduplicated, and cleared when the top document
  announces itself (83-110). The page layer then runs the runtime *inside that frame* through
  `callAsyncJavaScript … inFrame:` (`content_world.rs:136-165`).
- **Platform variants.** WebKitGTK cannot evaluate in subframes from the app. There, each frame's world script
  long-polls Misty through a reply-carrying message handler and runs the bodies Misty returns
  (`agent_pages/frames/linux.rs:1-60`). On Windows, frames come from WebView2 DevTools sessions
  (`frames/windows.rs`).
- **Snapshot merge** (`page_agent/frames.rs:23-31, 142-198`). The 6 most recent frames are read, and frames under
  80×40 px are skipped (122-124). Each gets 6000 chars and 300 refs from its slot's range, with 16000 chars in
  total for all frames. `splice_trees` places each frame's tree under the `- iframe … [cross-origin <origin>]`
  line whose origin matches, or the first unclaimed one, and appends the rest (`frames/splice.rs:39-108`). Skills
  are merged (111-122) and Markdown is appended with an "Embedded frame from" header (125-137). Waits on `text`
  also check frames (`execute.rs:155-157`, `frames.rs:201-211`).
- Steps on frame refs run in the frame, with **script-only input** (`checked.rs:17-22`). A trusted click on an
  element inside a cross-origin payment or widget frame is therefore not available today. It could be done with a
  native click at a top-viewport point computed by adding the iframe element's rect in the parent, which the top
  runtime already knows **(inferred)**.

---

## 8. Skills

`js/page_skills.js`. Each skill has `detect()`, a line of `instructions`, and `actions`. Detected skills are listed
in every snapshot (`detectSkills`, 450-451). Each action either acts in the page or returns `steps` and an
optional `then` continuation, which run through the normal gated step runner, up to 4 phases
(`page_agent/batch/skill.rs:7-121`).

| Skill | Detects | Actions |
|---|---|---|
| `grid` (97-158) | `[role=grid]` or a contenteditable table with at least 4 cells | `goto` (Name box fill and submit, or click the cell), `read` (TSV from `aria-label`ed or `data-k` gridcells), `paste` (select the start cell with real input, then `pasteHere` dispatches a synthetic `ClipboardEvent` with TSV and HTML; up to 1000×100) |
| `editor` (160-208) | ProseMirror, Lexical, Quill or contenteditable more than 60 px tall, including same-origin editor frames | `insert {ref, markdown, at}`: Markdown to HTML, then a synthetic paste, falling back to `execCommand("insertHTML")`. `read` |
| `forms` (210-259) | 3 or more visible fields | `answer {answers:[{question,value}]}`: matches fields and choice groups by label text and returns up to 30 fill, select or click steps. Never submits |
| `pickers` (261-299) | combobox, datalist, date input, calendar | `choose` (fill, wait for the text, then click the matching option); `date` (fill a date input, or click a calendar day by month name and day number) |
| `boards` (301-306) | kanban-like markup | instructions only |
| `google-sheets` (322-341) | docs.google.com/spreadsheets | `paste`/`goto` via the grid skill; `read` is a **synchronous XHR** to `/export?format=csv&gid=` using the person's session cookies (313-319, 330-339) |
| `google-docs` (364-416) | docs.google.com/document | `read` via `/export?format=txt`; `write` with synthetic key events plus `execCommand("insertText")` into `.docs-texteventtarget-iframe`, using Docs shortcuts for headings, lists and bold |

The `pasteHere` and `clickOption` steps are hidden from the listed actions (451).

---

## 9. Consent, popups, the consequence judge and confirmation

**Cookie and consent banners** (`js/page_read.js:47-98`). The order of attempts:

1. Click a control whose label matches the `DECLINE` regex (reject, decline, necessary only, continue without
   accepting, and similar). It must be inside an ancestor within 8 levels whose id, class or aria-label mentions
   cookie, consent, privacy, GDPR, OneTrust, Didomi or CMP, or whose text mentions cookies. Open shadow roots are
   searched, up to 50 (54-62).
2. Otherwise click a `CLOSE` control inside a consent banner.
3. Otherwise **hide** a fixed or sticky banner whose only button is "Accept" (`display:none !important`) and hide
   empty backdrops. **It never accepts.**

This runs after each load in agent tabs, at 1.2, 3.0, 6.0 and 10.0 s, together with at most 2 popup dismissals
(`page_agent/consent.rs:7-23`, triggered in `pages/create/events.rs:34-44`). It also runs before every full
snapshot (`execute.rs:45-49`) and after `landed`.

**Uninvited popups** (`page_read.js:101-174`). `coveringPopup` samples `elementFromPoint` at (0.5,0.5), (0.5,0.3)
and (0.5,0.7). Walking up from the hit, it takes the outermost fixed-position or dialog element covering at least
25% of the viewport. It skips app shells: an element that contains `main`, or more than 60% of the page's text when
the page has over 400 chars. An empty box is a backdrop. Close candidates must match `CLOSE`, an aria-label
starting with close or dismiss, or a close-ish class with a short label, and must not match `NOT_CLOSE` (sign up,
subscribe, log in, accept, continue, buy…). `dismissPopup` tries the close control, waits 400 ms, sends Escape,
waits 300 ms, then hides the box, checking each time whether it still covers the page.

**Consequence classification** (`js/page_consequence.js`):

- `kindOfName` (13-35) maps a control's name to `payment`, `delete`, `publish` or `send`, using multilingual word
  lists (Latin scripts with Unicode-aware word boundaries; CJK matched as substrings).
- `consequence` also flags broader words (submit, invite, share, unsubscribe…) (39-40).
- **Payment forms** are recognized by `cc-*` autocomplete, card or CVV field names, payment iframes (Stripe,
  Braintree, Adyen, PayPal, "checkout", "payment") or an action path like `/checkout|pay|billing|orders` (42-50).
- A plain navigation link named like a payment ("Buy now" on a front page) is exempt (58-63).
- **Enter** in a field is judged by what it submits: the form's default button, a payment form, or a composer next
  to a send or post button. Cmd/Ctrl-Enter in any multiline field counts as a send (76-102).

**Two-tier gate** (`page_agent/step/checked.rs:69-111`):

1. A step whose `consequenceKind` is in the account's `confirm_kinds` (defaults to all four; **payment always
   asks**; `action_confirm.rs:21-39`) waits for the person in the "island" for up to **180 s**
   (`action_confirm.rs:96`). Silence counts as refusal. In auto mode, remembered "Accept and remember" grants for
   exact https origins skip send, delete and publish, but never payment (`action_confirm.rs:62-80`,
   `tool_gate.rs:305-356`). The model hears a fixed message: "Don't try another way to do it".
2. Any other consequential step is refused with `browser_consequential_requires_approval` unless the model passed
   `allowConsequential:true` (the catalog tells it to do so only when the step is part of the person's task).

**Click judge for visual points** (`page_agent/judge.rs:61-82`, used by `input/interact.rs:94-104`). For
`browser.visual` / `browser.act` native clicks planned from a screenshot, `consequenceAt` hit-tests the
fractional point, takes the closest pressable ancestor or label control, and classifies it. A payment iframe under
the point counts as payment (`page_consequence.js:151-158`). The page's verdict decides. The model's own
`consequential` flag can only *add* a stop, through a keyword regex (`tool_policy::kind_of`); it cannot remove one
(test at `judge.rs:141-152`).

**Run-level policy** (`run_control/tool_policy.rs:249-332`, `tool_gate.rs`, `run_taint.rs`):

- The mode comes from the run request, never from the model (`RunFacts::of_request`, 40-81).
- Ask modes stop before `browser.steps`, `fill_form`, `skill`, `run`, `navigate`, `upload` and `act` (85-109).
  Engines may navigate and open pages without asking (322-330).
- Plan mode refuses browser writes (112-124).
- **Taint**: after a private read (notes, files, threads, shell, integration reads; `run_taint.rs:25-37`),
  opening a URL with a query or fragment on an unapproved host, or carrying a token-like path segment (24 or more
  characters with letters and digits, or 48 or more), asks the person (`run_taint.rs:112-136`). Programs are
  scanned for URLs (139-152) and checked again at run time when they open an address (`tool_gate.rs:205-236`).
- Private or LAN hosts are refused unless the person's own prompt names them (`tool_policy.rs:236-245`).
- **Site blocks**: banks, brokerages, payments, crypto and adult domains and TLDs are blocked from *acting* by
  default; reading is allowed (`page_agent/site_blocks.rs:30-158`). They are enforced in `agent.rs:53-74` before
  any input.
- **Take-over**: when the person holds the page, an engine's browser calls are refused (`take_over.rs:42-44`).
- **Secrets**: password, OTP and card fields cannot be filled (`page_actions.js:137`). The model is told to call
  `browser_request_user_action`.

---

## 10. Step pictures and visual capture

- **Step pictures** (`run_control/step_pictures.rs:80-123`). After each `tool.completed` or `tool.failed` event of
  a browser tool, throttled to one every **1.2 s** per run (19), Misty captures the run's tab. The capture uses
  `WKWebView.takeSnapshotWithConfiguration` (`pages/macos/capture.rs:7-85`): a JPEG at most 640 px on its long
  side, `afterScreenUpdates:true`, 15 s timeout. Pictures over 400 KB are dropped (21). They are stored in
  `~/.misty/data/run-pictures/<run>/<uuid>.jpg` and linked to the step row. They are **macOS only**
  (`run_picture.rs:56-59`).
- The renderer separately pictures the tab after each job for the PiP and the tab strip
  (`browserJobRun.ts:146`, `pictureAgentTab`).
- `browser.visual` returns the same 640 px JPEG with the inspection. The BU Bench runner records screenshot timing
  as "after_tool_event" (`benchmarks/bu-bench/misty_eval.py:466`).
- **Agent cursor and ring**: an in-page overlay cursor (`kiri_link/scripts/agent_cursor.js`) glides 320 ms
  before input. The person's own physical input is blocked from a locked agent view by an `NSEvent` local monitor
  (`input/macos/lock.rs:1-40`).

---

## 11. CDP and Playwright dependency

| Mechanism | macOS / Linux | Windows |
|---|---|---|
| Isolated script world | none (WKContentWorld, WebKitGTK world) | **hard**: `Page.createIsolatedWorld` via WebView2's in-process DevTools (`content_world.rs:39-80, 178-231`) |
| Cross-origin frames | none (WKFrameInfo; GTK long-poll) | **hard** (DevTools frame tree, `frames/windows.rs`) |
| AX tree / snapshot | none (DOM walk, approximate accname) | none |
| Input | none (AppKit / GTK events) | none (`windows_dispatch.rs`, Win32) **(inferred from file names)** |
| Screenshots | none (`takeSnapshot`) | none |
| Network idle, request bodies | not implemented | not implemented |

On macOS and Linux the current harness is CDP-free. Windows depends on DevTools today; the harness README states
this ("Windows is open").

---

## 12. Answer (1): do agent tabs use the person's signed-in profile?

**Yes, by construction.**

- Agents have no windows of their own. Their tabs live in the person's window (`app_windows/mod.rs:1-12`).
- `browser_webview_create` takes the profile **from the calling window's label, never from the request**
  (`pages/create/mod.rs:31-35`). It resolves the profile's store (`profiles::page_store` →
  `app_windows::store_for_profile`, `profiles/mod.rs:160-171`, `app_windows/registry.rs:184-189`) and opens the
  WKWebView with `data_store_identifier(webkit_store_identifier(store))` (`create/mod.rs:94`). That gives a
  persistent `WKWebsiteDataStore(forIdentifier:)` per profile.
- The `personal` profile of the account that first signs in maps to `None`, which is "this computer's original
  store" (`registry.rs:158-172`, `site_data/profile_store.rs:5-9`). Other profiles get
  `SHA-256("misty.profile-store.v1", scope, profile)` (`app_windows/mod.rs:140-144`).
- The engine's `screen_open` description says outright that the tab "carries their signed-in sites"
  (`mcp.rs:69-74`), and `INSTRUCTIONS_WITH_BROWSER` repeats it (88-93).
- Sign-ins are by real cookies in the WebKit store. No Composio-style connector is involved in browsing. The
  `integration.*` tools are a separate family, offered alongside (`mcp.rs:76-79`).
- The user agent is set to the installed Safari's, so sites serve their modern UI (`create/mod.rs:95-103`).

**Cases where it does not, or where it differs:**

1. **A different profile window.** The tab gets the store of whichever profile's window the run is attached to
   (`entry.windowLabel`, `src/features/agents/tools/screenTools.ts:178`). A run started from a non-personal
   profile window sees that profile's sign-ins, not the personal ones.
2. **Dev and named builds have their own stores.** `for_profile` mixes the build profile into the identifier for
   non-release builds (`profile_store.rs:51-63`). On first use, `link_store_data` *copies* the shared store once
   (86-104). **Benchmarks run in the debug app** (BU Bench README: "Start Misty's debug app … with the eval
   bridge", which is compiled only in debug, `eval_bridge/mod.rs:1-9`). They therefore use a *snapshot copy* of
   the release store taken when that dev store was first created. Sign-ins made later in the release app do not
   carry over, and sign-ins made in the dev app stay there. **Check this before relying on signed-in benchmark
   tasks.**
3. **Account switch.** Changing the Misty account closes all pages (`account_views.rs:6-28`). A live webview
   cannot change store (`create/mod.rs:48-62`, `browser_profile_changed`). The derived store depends on the
   account `scope`, so each Misty account has its own non-personal stores.
4. **Incognito windows** are not person windows and cannot run agents (`agent.rs:15-18`, `is_person_window`).
   No private or non-persistent store is ever used for agents.
5. **Account barrier, partly built.** Every observation carries `accountIdentity:"unverified"` and the profile id
   (`agent_actions.rs:91-100`). The checks for `target["authentication"] == "required"` (`execute.rs:20-32`,
   `agent.rs:83-85`, `agent/operations.rs:14`) are **never triggered**: `browser_target_observation` never sets
   that field (verified by grep). Sign-in walls are left to the model calling
   `browser_request_user_action{action:"sign_in"}`. The `semantic_snapshot.js` account probe, Todoist only,
   invalidates refs when the signed-in account changes (`page_core.js:205-215`).
6. **Sleeping tabs** keep cookies, since the store persists, but lose in-memory page state (§6).
7. **Blocked sites**: on banking, crypto and similar domains the agent can read with the person's session but not
   act (§9).
8. **Engine runs without the browser attachment** get no browser tools at all (`mcp.rs:261-265`).

---

## 13. Answer (2): what stays in Misty and what could move to a "brain" sidecar

### Must stay in Misty's process

These are the trust and handle boundary:

- **Webview handles and data stores.** `WKWebView`, `WKWebsiteDataStore(forIdentifier:)`, `WKFrameInfo` (held
  thread-locally on the main thread, `frames.rs:71-75`), `WKContentWorld`, and WebKitGTK/WebView2 handles. They
  are main-thread AppKit or GTK objects inside the Tauri process. A second process cannot open the same persistent
  store concurrently in a supported way **(inferred)**.
- **Native input dispatch** with its pre-dispatch checks: generation, origin, viewport, visibility and grant, all
  re-checked *on the main thread at the moment of the event* (`native_input.rs:202-243`). It also includes the
  person-input lock (`macos/lock.rs`).
- **Captures** (`takeSnapshot`), downloads (`WKDownload` delegate, `history_downloads`), the frame announcement
  handlers, and the page-load and navigation delegates (`create/events.rs`).
- **The gate**: journal, tool policy, taint, site blocks, take-over, the confirmation island with its 180 s wait,
  remembered grants, and per-operation grants and leases (`agent_control.rs`, `agent_grants.rs`). The point is
  that "neither the model nor a window can skip this" (`action_confirm.rs:1-7`). A sidecar must not be able to
  mark its own action as approved.
- **The consequence verdict at dispatch time.** `prepare` computes `consequenceKind` inside the page world, and
  Rust gates on it *before* sending native input (`checked.rs:45-111`). If a sidecar computed the verdict, a
  compromised or buggy brain could claim "no consequence". The classifier JS can live in either place, but Misty
  must run it and act on its result itself.
- **The script world contents.** The current design evaluates only the fixed `RUNTIME` constant, never
  model-supplied JS (`page_agent/mod.rs:116-118`). A primitive `eval(js)` exposed to a sidecar would give it
  arbitrary script execution in the person's signed-in pages: reading non-HttpOnly cookies, issuing same-origin
  fetches as the person, submitting forms. That would be a large privilege escalation. `browser.run` programs run
  in QuickJS and reach pages only through named operations (`pageHost.ts`), which is the right model.

### Could move to a sidecar

The sidecar would own orchestration and judgement:

- The MCP server facing engines (today `mcp.rs` in-process) and its tool descriptions.
- Batch semantics: step sequencing, stop-on-navigation/dialog, the `allowConsequential` second tier, after-step
  snapshot policy, and retries. This is `batch.rs` and `run_step` minus native dispatch.
- Waits and polling loops (`poll`, `first_load`, `landed`), given an "is the page there" primitive. Skill phase
  loops (`skill.rs`).
- Frame tree splicing, ref-slot bookkeeping (`frames.rs:49-113`) and Markdown assembly.
- The `browser.run` program sandbox (QuickJS), which today runs in the renderer.
- Recovery heuristics: the blank-tab retry (`browserJobRun.ts:51-67`), stale-ref re-read (`pageHost.ts:151-164`),
  dismiss-and-retry on cover, link fallback, and the native re-type when a fill is not retained.
- Extraction calls to an engine or model, step-picture selection, trace and benchmark evidence, and self-healing
  stores (locators, per-site notes).
- Arguably the *source* of the page runtime itself, versioned with the sidecar. Misty would then accept a runtime
  bundle only if it is signed or hash-pinned **(recommendation)**.

### A narrow protocol of page primitives

The sidecar needs these from Misty (JSON-RPC over a local socket; every call carries `runId`, `scopeId`,
`callId`). Misty checks the grant, take-over and the site block on each one.

| Primitive | Returns / notes | Exists today as |
|---|---|---|
| `tabs.open {url?}`, `tabs.close`, `tabs.list` | `scopeId`, url, title | `screen.open/close`, `agentTabs.ts` |
| `page.state` | `{url, title, origin, loading, loadGeneration, documentMark, viewport{w,h,zoom}, visible}` | `view.url()`, `snapshot_generation`, `waitCheck` |
| `page.navigate {url}` | navigation id; URL policy (private host, taint) checked by Misty | `browser.navigate` before `landed` |
| `page.op {frame?, op, args}` | Runs a **named runtime operation** (`snapshot`, `find`, `markdown`, `prepare`, `observe`, `waitCheck`, `settle`, `mark`, `locate`, `locatorFor`, `skill`, `declineConsent`, `dismissPopup`, `consequenceAt`, `consequenceOfKey`, `describeRef`) in the agent world. No raw JS | `call_at` + `P.call` operations map (`page_read.js:189-199`) |
| `page.frames` | `[{frameId, url}]` cross-origin frames | `frames::list` |
| `page.act {ref, documentId, action, args, allowConsequential}` | Misty runs prepare, then the consequence gate, then native or script input, and returns the outcome. The confirmation island stays in Misty | `run_step_checked` |
| `page.input {kind, x, y, …, expect{generation, origin, viewport}}` | Only for visual-point actions. Misty runs `consequenceAt` and the judge first | `browser.interact` native + `judge_point` |
| `page.capture {rect?, maxDim, format}` | Image bytes | `capture_webview_region_sized` |
| `page.upload {ref, documentId, fileId}` | Misty resolves `fileId` (attachment or download) to bytes; the sidecar never passes paths | `batch::upload` |
| `events.subscribe` | Load started/finished, URL change, title, popup/new window, download started/finished, frame announced, take-over, tab slept/woke | `misty://browser-page` and friends |
| `person.ask {kind, control, reason}` / `person.handoff {action, reason}` | Allowed / refused / unanswered; resumed | `action_confirm::ask`, `request_user_action` |

With this split, `page.act` stays coarse on purpose. The safety-critical sequence (resolve the ref, compute the
point, classify, ask, check the generation, send the native event) is one Misty call, so a sidecar crash between
"asked" and "clicked" cannot leave a half-approved action. A sidecar crash loses only orchestration. The journal
already records writes as "uncertain" when interrupted (`local_tools.rs:351, 378`).

---

## 14. Notable gaps to compare against Skyvern and browser-use (inferred from what is absent)

1. **No visual grounding of refs.** Snapshots are text only. `browser.visual` returns an image without ref labels
   drawn on it. There is no "set-of-marks" overlay mapping refs to boxes, although `prepare` could supply the
   rects.
2. **No interactive-element diff** between steps. browser-use-style "new element" marking is absent; the model
   gets a full 12k snapshot after each batch.
3. **No viewport partition or bounding boxes**, and no paint-order filtering at snapshot time. Covered elements
   appear in the tree and fail only at prepare.
4. **No network-quiet wait.** WebKit offers no request interception without CDP. A
   `WKURLSchemeHandler`/`WKContentRuleList` approach cannot see request completion either, so DOM quiet plus
   `readyState` is all there is.
5. **Typing is a single `insertText`**, not per-character keystrokes. Sites that key off
   `keydown`/`keypress` per character (some autocompletes, OTP boxes) may not respond.
6. **Cross-origin frame input is script-only** (untrusted events).
7. **Engines cannot upload files** and cannot use `browser.extract`.
8. **No self-healing store** beyond `{role, name, index}` locators. The Odysseys lessons are written into code
   comments and heuristics (for example `page_tree.js:299-300`, `page_tree.js:373-376`, `checked.rs:246-249`),
   not learned per site.
9. **The runtime is re-sent at about 114 KB per call**, including the 250 ms polls.
10. **The authentication barrier is dead code** (§12.5), and the account probe covers only Todoist.
