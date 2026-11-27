# Parity with Playwright MCP

The harness copies Playwright's agent tool surface and its page-side code, item by item, until an engine can do
in Misty anything it can do through Playwright MCP, on the system webview and without CDP.

## Why Playwright

All the leading harnesses are permissively licensed, so the choice came down to what can run on a native webview:

| Repository | License | Drives pages through | What we can take |
| --- | --- | --- | --- |
| microsoft/playwright (MCP server in `packages/playwright-core/src/tools/backend`, page code in `packages/injected`) | Apache-2.0 | Its own protocol over CDP, WebKit's inspector and Juggler | The most complete agent tool surface (about 90 tools) and the response every tool returns; its injected scripts (`ariaSnapshot.ts`, `roleUtils.ts`, `domUtils.ts`, actionability) are plain DOM code that runs in our script world unchanged |
| browser-use/browser-use | MIT | CDP | Ideas already taken (effect probe, compact state); its DOM reads are CDP calls |
| vercel-labs/agent-browser | Apache-2.0 | CDP (Rust) | Command names; nothing that runs without CDP |
| browserbase/stagehand | MIT | Playwright/CDP, model in the loop | Caching idea; its acts call a model |
| alibaba/page-agent | MIT | Page-side script | Already ported (`page_tree.js`, `page_actions.js`) |

Playwright is the reference: Apache-2.0 is compatible with Misty's AGPL, its tool surface is the one engines
already know, and it is the one whose page-side code we can copy as is. Reference commit:
`microsoft/playwright@c2ebabaf153d7191c8ce959a20d622b9faa57025` (2026-11-26). Copied code keeps its license
header and is credited in Misty's `NOTICE`.

## Status

Have: works today. Partial: some of it. Missing: to build. Not here: can't be done on a system webview without
CDP, or doesn't belong in Misty; the reason is given.

### Every answer (`response.ts`)

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| R1 | Every action answers with its result, the page (url, title), open tabs, a modal state (dialog or file chooser waiting), new console errors, new downloads and a snapshot | Steps answer each step's effect, the page, a dialog or file chooser on the step that opened it, new console errors and warnings (`console`), new downloads (`downloads`) and a compact snapshot | Have | |
| R2 | Incremental snapshot of what changed | Compact state, `*` before new controls | Have | |
| R3 | A tool called while a modal is open fails and names the modal | A held dialog makes every other page tool fail with `browser_dialog_held`, naming it and how to answer; a file chooser stops the batch with its ref | Have | |

### Page model

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| S1 | `browser_snapshot`: aria snapshot with refs, from `injected/ariaSnapshot.ts` and `roleUtils.ts` (full accname, roles, states, `[cursor=pointer]`, `[active]`) | `browser.snapshot`: roles, accessible names and states from Playwright's own `roleUtils.ts` (vendored, `js/vendor_playwright_roles.js`), our refs, budgets, compact state and agent-specific names where Playwright gives none (file inputs, cards holding their own buttons); refs on draggables and named containers | Have | |
| S2 | `browser_find` | `browser.find` | Have | |
| S3 | `browser_take_screenshot` (viewport, full page, one element, css or device scale) | `browser_visual` and `screen_look` on macOS (WebKit snapshots), Windows (WebView2's own capture of a clip) and Linux (WebKitGTK snapshots, cropped): the view, one element (`ref`), the full page (`fullPage`, stitched from views), css or device scale, png or jpeg | Have | |
| S4 | `browser_generate_locator` | Locators returned with each step (`locatorFor`) | Have | |
| S5 | Frames inside the snapshot | Same-origin and cross-origin frames spliced in (`frames.rs`) | Have | |
| S6 | `browser_highlight`, `browser_hide_highlight`, `browser_annotate` | `browser_highlight` and `screen_highlight`: an outline with an optional label on one or more refs, drawn in a closed shadow root that follows the element, takes no clicks and stays out of the tree; `clear` takes it away. Pictures show it | Have | |

### Input

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| I1 | `browser_click` (double, right, modifiers) | `click` step: double, right, and modifiers held (Meta, Control, Shift, Alt), native first | Have | |
| I2 | `browser_hover` | `hover` step | Have | |
| I3 | `browser_drag` from one ref to another | `drag` step from `ref` to `to`, or between points; native drag first, then pointer events and HTML5 drag events | Have | |
| I4 | `browser_drop` files or data on a ref | `browser_upload` with `drop: true` drops a file from the working folder; a `drop` step drops text, a link or both on a ref, in engines' steps and apps' `screen_steps` | Have | |
| I5 | `browser_type` (slowly, submit) | `type` step: one native insert, or `slowly` one real key at a time; submit | Have | |
| I6 | `browser_press_key` any key or chord | `key` step: named keys, F1–F12, Insert, characters, with any modifiers. ⌘ chords that would act on the window (⌘W, ⌘Q, ⌘Enter) reach the page as its own key events, never as native input, so a page's shortcuts (⌘S, ⌘B, ⌘Enter to send) work and the consequence gate judges ⌘Enter on a send box | Have | |
| I7 | `browser_press_sequentially`, `browser_keydown`, `browser_keyup` | `type` with `slowly`; `key_down` and `key_up` steps | Have | |
| I8 | `browser_select_option` | `select` step | Have | |
| I9 | `browser_check`, `browser_uncheck` | `check`, `uncheck` steps | Have | |
| I10 | `browser_fill_form` | `browser.fill_form` | Have | |
| I11 | `browser_file_upload` answers the file chooser a click opened | A click on a file input during steps is held back (no system panel) and the step answers `fileChooser` with its ref; `browser_upload` is offered to engines and takes a `path` in the working folder | Have | |

### Vision (pointer by coordinates)

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| V1 | `browser_mouse_click_xy` | `click_at` step (button, clickCount), judged by the consequence gate at the point | Have | |
| V2 | `browser_mouse_move_xy` | `move_to` step | Have | |
| V3 | `browser_mouse_drag_xy` | `drag` step by points | Have | |
| V4 | `browser_mouse_down`, `browser_mouse_up` | `mouse_down`, `mouse_up` steps, native press and release at a point | Have | |
| V5 | `browser_mouse_wheel` | `wheel` step at a point: a wheel event and the box under it scrolled (WebKit drops synthesized native wheel events, so this path is scripted and checked) | Have | |

### Navigation and tabs

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| N1 | `browser_navigate` | `browser.navigate` | Have | |
| N2 | `browser_navigate_back` | `browser_navigate` with `history: back`, from the harness (`navigation.rs`) | Have | |
| N3 | `browser_navigate_forward` | `history: forward` | Have | |
| N4 | `browser_reload` | `history: reload` | Have | |
| T1 | `browser_tabs` list, new, select, close | `screen_open`, `screen_close`, `browser_tab_list`, `browser_tab_use` | Have | Different shape, same reach; a tab a page opens is listed |
| T2 | `browser_close` | `screen_close` | Have | |

### Modals, files and downloads

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| M1 | `browser_handle_dialog` (accept, prompt text) for alert, confirm, prompt, beforeunload | While steps run, an alert, confirm, prompt or beforeunload nobody armed is held natively, the page paused under it: WebKit's UI delegate on macOS, WebView2's ScriptDialogOpening with a deferral on Windows, WebKitGTK's script-dialog on Linux. The batch stops naming it and a `dialog` step answers it; one left unanswered is dismissed after 3 minutes. A `dialog` step armed ahead still answers in the page world | Have | |
| M2 | File chooser as a modal state | See I11 | Have | |
| D1 | Downloads reported in the answer of the step that started them | `downloads` in the step answer, with what `browser_upload` needs | Have | |

### Waiting and checking

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| W1 | `browser_wait_for` text, textGone, time | text, textGone, urlIncludes, seconds | Have | |
| W2 | Actions wait for the page to settle, network included | Settle waits for DOM quiet and for the page's fetch and XHR calls (`page_network.js`, installed in every browser tab and app) | Have | |
| W3 | `browser_verify_element_visible`, `browser_verify_text_visible`, `browser_verify_list_visible`, `browser_verify_value` | `browser_verify` and `screen_verify`: element (role and name visible), text, list (items in the list at a ref) and value checks, up to 20 at once, each saying what it found when it fails | Have | |

### Page code, console and network

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| E1 | `browser_evaluate` a function on the page or an element | `browser.run`, a program on the page | Have | |
| E2 | `browser_run_code_unsafe` (Playwright API code) | | Not here | It is Playwright's own API |
| C1 | `browser_console_messages`, `browser_console_clear` | `browser_console` (level, clear) in the browser, `screen_console` in apps, from `page_console.js` installed at document start | Have | |
| NW1 | `browser_network_requests`, `browser_network_request`, `browser_network_clear` | `browser_network` and `screen_network`: the page world keeps its last 500 requests (fetch and XMLHttpRequest as they run, the rest from resource timing) with method, address, status, type, content type and time; `request` gives one in full, its request and response headers (sign-in headers hidden) and text bodies, kept for the last 100 fetch and XMLHttpRequest calls. Static loads only with `includeStatic`, `filter`, `clear` | Have | Resource-timing loads (images, scripts, the document) carry no headers: the page world can't see them |
| NW2 | `browser_route`, `browser_unroute`, `browser_route_list` | | Not here | A system webview can't intercept http(s) requests without CDP |
| NW3 | `browser_network_state_set` (offline) | | Not here | No offline switch per view |

### Storage, PDF and emulation

| # | Playwright | Misty | Status | Plan |
| --- | --- | --- | --- | --- |
| ST1 | Cookies: list, get, set, delete, clear | `browser_storage` with `store: cookies`, in the agent tab's own store only, never the person's tabs: `WKHTTPCookieStore` on macOS, WebView2's cookies on Windows, WebKitGTK's cookie manager on Linux (there, the cookies of the page's own address). set takes domain (the page's host by default), path, expires, httpOnly, secure, sameSite | Have | |
| ST2 | localStorage and sessionStorage: list, get, set, delete, clear | `browser_storage` with `store: local` or `session`, from the runtime's world, which shares the page's storage; agent tabs only | Have | |
| ST3 | `browser_storage_state`, `browser_set_storage_state` | | Not here | Agent tabs start signed out on a store of their own by design |
| P1 | `browser_pdf_save` | `browser_pdf` and `screen_pdf`: the whole page as a PDF (WebKit's createPDF, WebView2's printToPDF, WebKitGTK's print to file) into the run's working folder, never over a file already there | Have | |
| EM1 | `browser_resize` | `browser_emulate` and `screen_emulate` `width` and `height`: the page's native view is drawn at that size, fitted and centered in its pane, at the matching zoom, so the page sees exactly the width and height asked for and the person sees all of it; agent tabs and apps, on every system | Have | |
| EM2 | `browser_emulate_media` (color scheme, print) | `browser_emulate` and `screen_emulate` `colorScheme` and `media: print`, and `reset`: the view's appearance and media type on macOS, emulated media on Windows | Have | WebKitGTK has no per-page color scheme or print media, so Linux refuses those two |

### Recording and debugging

| # | Playwright | Status | Reason |
| --- | --- | --- | --- |
| X1 | `browser_start_tracing`, `browser_stop_tracing`, `browser_start_video`, `browser_stop_video`, `browser_video_*`, `browser_start_recording`, `browser_stop_recording`, `browser_resume` |  | Not here | Debugging for test authors; Misty keeps its own browser log per run |
| X2 | `browser_webmcp_list`, `browser_webmcp_call` | Apps expose `document.modelContext` tools through `screen.js`; agent tabs get `navigator.modelContext` and `document.modelContext` in the page world (`page_webmcp.js`), listed and called by `browser_page_tools`; a tool not marked read-only needs allowConsequential and passes the same approval as a consequential click | Have | |
| X3 | `browser_get_config` |  | Not here | Playwright's own settings |

## Tests

Every item is checked on real WebKit by the standalone host on macOS. The Windows parts are type-checked with `cargo xwin check --target x86_64-pc-windows-msvc`, and the Linux parts against the real GTK, WebKitGTK and libsoup crates; neither has run on its own system yet. On macOS, `npm run test:webkit` in `harness/` loads the
pages in `tests/webkit/` and runs each scenario's steps through the same harness code Misty runs, checking each
answer. The runtime has jsdom tests (`npm test`) and the Rust step logic has unit tests with a fake host.

## Speed

The runtime is sent to a page once: each call first runs a small body that uses the runtime already in the
page's script world (checked by a hash of the runtime), and only a page without it, or with an older one, gets
the whole runtime. Pages restored by back and forward keep theirs.

## Order of work

1. Modal state: dialogs and the file chooser (M1, M2, I11, R3).
2. Every step answer carries the modal state, new downloads and console errors (R1, D1).
3. Back, forward, reload (N2–N4) and waiting for time (W1).
4. Pointer by coordinates and drag (V1–V5, I3), dropping files and data (I4).
5. Keyboard: modifiers on clicks, per-key typing, keydown and keyup, more keys (I1, I5–I7).
6. The runtime installed once per page, and the network counter switched on (W2).
7. Accessible names and roles from Playwright's `roleUtils.ts` (S1).
8. Element and full-page pictures (S3).
9. Console messages and network requests (C1, NW1).
10. Cookies and web storage for agent tabs (ST1, ST2).
11. PDF, resize, color scheme, verify and highlight (P1, EM1, EM2, W3, S6).
