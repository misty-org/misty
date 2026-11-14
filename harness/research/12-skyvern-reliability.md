# 12. Skyvern: execution and reliability (read from source)

Source studied: a downloaded Skyvern checkout (read only, nothing executed). All paths are relative to the Skyvern repo root. Line numbers are from that checkout. Anything not read directly is marked "(inferred)".

Companion reports: `11-skyvern-page-representation.md` covers the scraper and element tree. This report covers what happens after the model has picked an action: dispatch, per-action handlers, verification, retries, the cached-script ("run with code") system and its self-healing loop, auth and sessions, CAPTCHA, failure classification, and the `evaluation/` folder.

---

## 0. Executive summary

Skyvern's reliability is not one trick. It is roughly 20,000 lines of defensive action handling (`skyvern/webeye/actions/handler.py` is 17,620 lines), arranged as a set of fallback ladders. Each ladder is backed by a readback check, so the agent finds out when an action failed instead of believing it worked. Six ideas matter most to Misty:

1. **Ladders, not single calls.** A click goes through up to 8 strategies: href navigation, the normal click, label `for=` targets, label children, bound labels, a coordinate click, clicking the blocking element, and a synthetic JS event sequence (`chain_click`, handler.py:12701). Text input goes through value readback and atomic re-entry, with special paths for phone and card fields, secrets, TOTP codes, autocomplete and date fields (handler.py:9574-10950).
2. **Verify, don't trust.** After an action it checks a MutationObserver diff (new elements appeared), reads the value back, reads checkbox state before and after, and runs an LLM `complete_verify` before any COMPLETE is accepted (agent.py:7953, handler.py:11756).
3. **A failed action becomes text for the next plan.** An `ActionFailure` carries `followup_message`, `stop_execution_on_failure` and `skip_remaining_actions`. The step fails and is retried up to `MAX_RETRIES_PER_STEP=5` (config.py:225). The next prompt includes the action history and the failures.
4. **Record, replay, heal.** A successful agent run is compiled with libcst into a Python script that calls `page.click(selector=..., prompt=..., ai="fallback")`. On replay, if a selector misses, the AI takes over for that one element and records a "fallback episode". After the run, an LLM "script reviewer" rewrites the cached block, adding branches without removing existing ones. A whole block that fails falls back to the full agent (`_fallback_to_ai_run`, script_service.py:1597).
5. **Secrets never reach the model.** Credentials become random placeholder ids, and the handler swaps in the real value at type time (handler.py:12572). TOTP codes are generated from stored secrets or polled from email or webhooks for up to 15 minutes (config.py:868).
6. **An engine-neutral facade.** Skyvern now ships `skycdp`, a Playwright-shaped facade over a raw CDP socket (`skyvern/webeye/skycdp/__init__.py:1-5`). The action layer is written against "engine selection", not against Playwright directly. That is the exact pattern Misty needs: a Playwright-shaped facade over wry IPC and native input events.

Most of this logic is **portable to a native webview**. The handler ladders are DOM-level JavaScript plus mouse and keyboard events. The real CDP dependencies are trusted input (Misty has native events), cross-origin frame access (WKFrameInfo works on macOS), download interception (WKDownload is better than what Skyvern has) and file-chooser interception (WKUIDelegate open panel).

---

## 1. License map

- Root `LICENSE` is AGPL-3.0. The README's License section says all core logic is AGPL-3.0 "with the exception of anti-bot measures available in our managed cloud offering" (README.md:589-590). No per-directory LICENSE files exist (`find -name LICENSE*` returns only the root). No SPDX headers were found in `skyvern/`. **So every file area recommended below (`skyvern/webeye/actions/`, `skyvern/webeye/utils/`, `skyvern/webeye/scraper/domUtils.js`, `skyvern/core/script_generations/`, `skyvern/services/`, `skyvern/forge/`, `skyvern/webeye/skycdp/`) is AGPL-3.0.** Misty is AGPL-3.0, so deriving from them is compatible. Keep the copyright notices and mark the modified files.
- Cloud-only hooks are **stubs** in OSS: anti-bot vendor handlers (`app.AGENT_FUNCTION.run_vendor_challenge_handler`, called at `skyvern/webeye/utils/captcha_solver.py:343-400`) and credential living-profile banking (`skyvern/forge/agent_functions.py:2165-2194`, where the docstring says it is a no-op in OSS). There is nothing to derive there.
- `evaluation/datasets/odysseys_tasks.json` is the Odysseys dataset vendored under **MIT** (`evaluation/datasets/ODYSSEYS_ATTRIBUTION.md`, which reproduces the notice). The WebVoyager data has no license file in the repo. Take WebVoyager from its upstream source, not from here.

---

## 2. Action dispatch architecture

**Registry with setup, handler and teardown.** `ActionHandler` (handler.py:5097) holds three class-level dicts mapping `ActionType` to async callables: `_handled_action_types`, `_setup_action_types` and `_teardown_action_types`. `_handle_action` (handler.py:6459) does the following, in order:

- waits for the challenge solver (`wait_for_challenge_solver`)
- wraps everything in `asyncio.timeout(BROWSER_ACTION_MAX_EXECUTION_SECONDS=1200)` (config.py:149; WAIT actions get their `seconds` added, handler.py:6672)
- rejects a WebAction whose `element_id` is not in the scrape, returning `MissingElement` with `stop_execution_on_failure=False` (`check_for_invalid_web_action`, handler.py:6702)
- for non-first actions in a batch, tries a stale-target remap (below)
- runs setup. If setup returns a non-success, the handler is skipped. This is how a "desired state already satisfied" click is suppressed.
- runs the handler, waits for the challenge solver again, then runs teardown
- in `finally`, maps the results to a tool-result string ("Tool executed successfully" or "Tool execution failed") for function-calling engines (handler.py:6630-6669)

Every known exception type (`MissingElement`, `MultipleElementsFound`, `LLMProviderError`, `ImaginarySecretValue`, `CaptchaSolveError`, timeout, `ScreenshotTargetClosed`, `InvalidElementForTextInput`) is converted to an `ActionFailure` rather than propagated (handler.py:6573-6625). The step loop then decides whether to continue. **CDP dependency: none.** This is pure orchestration.

**Stale-target remap within a batch.** The LLM returns several actions per step, all planned against one scrape. Before dispatching action N>1, `_refresh_stale_web_action_before_dispatch` (handler.py:6789) checks whether the injected `unique_id` marker for that element is still in the DOM. If it is not, it re-scrapes and re-binds the action to a unique element with the same tag in the same frame, matched by `structural_identity`. The remap is allowed only when:

- the target is in the main frame
- the URL did not change ("document continuity")
- the element has an HTML `id` "identity anchor". `name`, `aria-*`, `data-*` and `class` are explicitly not trusted (handler.py:6721-6745).

If the remap cannot be made safely but the target is provably stale, `_batched_target_stale_beyond_remap` (handler.py:6748) emits `StaleActionAbort` with `skip_remaining_actions=True`. The rest of the batch is then re-planned against a fresh scrape. **CDP: none.** This is DOM marker checks via evaluate. Native path: identical, using `callAsyncJavaScript` in the isolated world.

**Step-level batch policy.** In `_execute_step_actions` (agent.py:6454):

- WAIT actions are dropped when mixed with other actions (agent.py:6476-6490).
- Actions are linked by `element_id` so that a failed action with a later action on the same element continues ("duplicated element id", agent.py:6499-6513, 6884-6895).
- There is a random inter-action delay of `uniform(base, 2*base)` with `base=0.5s` (agent.py:6549, ~6790). It is skipped after a page-level SCROLL, because pages that enable "I agree" buttons only while scrolled to the bottom re-disable them after a delay.
- Failure handling (agent.py:6838-6908): if the last result succeeded, check `skip_remaining_actions`. A failed `DecisiveAction` (complete or terminate) does not retry. A failure with `stop_execution_on_failure=False` continues. Otherwise the step is marked failed and retried.

**Lesson for Misty:** carry `stop_execution_on_failure` and `skip_remaining_actions` flags in your tool results. They let the harness stop a multi-action plan safely without throwing.

---

## 3. Per-action handlers

### 3.1 Click (`handle_click_action` handler.py:7834, `chain_click` handler.py:12701)

The pre-click work in `handle_click_action`:

1. **Coordinate click** (vision or CUA engines). It runs `document.elementFromPoint(x,y)` to recover the `unique_id`. If the element is an `<a>` that should be navigated, it navigates instead. Otherwise it moves the cursor and calls `page.mouse.click`, `dblclick` or `click_count=3` (handler.py:7846-7890).
2. **Resolve the element**, then sleep `post_click_delay` (default 0.3s, handler.py:7898).
3. **Desired-state toggles.** If `click_context.desired_state` is set (the model said "this checkbox should end up checked"), read the live state first and suppress the click if it already matches. Native checkboxes are set directly (`_apply_desired_click_state`, handler.py:7777). This stops a retry from un-checking a box.
4. **Disabled handling.** Retarget to the single deepest interactable descendant (`_retarget_disabled_element_for_click`, handler.py:6939; `find_deepest_interactable_descendant_in_single_chain`, dom.py:912). It refuses when candidates sit in separate branches. Otherwise it waits until the element is enabled (`wait_until_enabled`, dom.py:497) or fails with `InteractWithDisabledElement`.
5. **scrollIntoView**, unless a deliberate SCROLL action just positioned this same element. That is tracked via `window.__skyvernScrolledElementId` (handler.py:7980-7997).
6. **Arm `IncrementalScrapePage.start_listen_dom_increment`** (a MutationObserver: `startGlobalIncrementalObserver`, domUtils.js:3908; observer at 3762) **before** clicking. That way the handler knows whether the click revealed new elements.

`chain_click` then works down this ladder. Each step records an `ActionFailure` with an `anchor` tag so the trace shows which strategies were tried:

| # | Strategy | Code |
|---|---|---|
| 0 | `<a target=_blank>` or PDF-object link to another host: `page.goto(href)` instead of clicking (`should_use_navigation_instead_click`, dom.py:740; `navigate_to_a_href`, dom.py:1685). It treats `net::ERR_ABORTED` and "Download is starting" as success. | dom.py:1700-1715 |
| 1 | Normal Playwright click with actionability checks (`EventStrategyFactory.click_element`, timeout `BROWSER_ACTION_TIMEOUT_MS=5000`, config.py:143) | handler.py:12790 |
| 2 | If `<label>`: click the `for=` target, then the first interactable `<input>` child | handler.py:12830-12870 |
| 3 | Else: click a label bound by `id`, then a label that is the direct parent, at position (0,0) | handler.py:12872-12910 |
| 4 | If not visible: stop | handler.py:12912 |
| 5 | Hit-test: `getBlockElementUniqueID` checks `elementFromPoint` at the rect center (domUtils.js:726). If nothing blocks, or a non-interactable element blocks, try a coordinate click (`coordinate_click`, dom.py:1525), then the JS event sequence. | handler.py:12925-13020 |
| 6 | If an interactable element blocks and it is the target's parent or sibling: click the blocker | handler.py:13030-13050 |
| 7 | Last resort: JS click, accepted only if `_did_page_respond` (the MutationObserver saw new elements) | handler.py:13060-13075, 12668 |

Details that matter:

- **Post-dispatch timeouts count as success.** If the click was dispatched but the navigation wait timed out, the result is success and later fallbacks are skipped. Re-clicking could double-submit (`is_post_dispatch_click_timeout`, handler.py:12800-12812).
- **Checkbox toggle verification.** `is_checked` is read before and after the coordinate and JS clicks. If the state did not change, the click fails (handler.py:12960-13010).
- **The synthetic click sequence** is pointerdown, mousedown, pointerup, mouseup, then `element.click()` at the rect center with `composed:true` (`_JS_CLICK_EVENT_SEQUENCE_JS`, page.py:496-514).
- **Post-click dropdown handling.** If the URL is unchanged and new elements appeared, `handle_sequential_click_for_dropdown` (handler.py:8253) re-scrapes the revealed subtree under a 30s budget (`DROPDOWN_SCAN_BUDGET_MS`, handler.py:443) and asks the LLM which option to pick (the custom-select prompt). This is how a click that opens a menu becomes a completed selection inside one action.

**CDP dependency: partial.** Playwright's `locator.click` actionability checks and `page.mouse` use CDP `Input.dispatchMouseEvent`. Everything else is JavaScript.
**Native path:** compute the rect and hit test in the isolated world, then post a native NSEvent (or GDK event) mouse down and up at the converted view coordinates. Those events are trusted, unlike JS events. Re-implement Playwright's actionability rules in JS before posting: visible, stable rect over two animation frames, enabled, and `elementFromPoint` at the target point returns the element or a descendant. Skyvern's own `skycdp` facade does exactly this over raw CDP: scroll into view, wait until "presented", compute the click point, add the frame offset, then mouse click (`skyvern/webeye/skycdp/facade/elements.py:330-362`). Copy that structure, swapping the CDP mouse call for a native event. For iframes, add the frame's viewport offset. On macOS that is computed by walking `frameElement.getBoundingClientRect()` up the frame chain (inferred).

### 3.2 Input text (`_handle_input_text_action` handler.py:9574-10950)

This is the most heavily fortified handler. Read in order:

- **TOTP and secret resolution first.** The action's `text` may be a secret placeholder or TOTP marker, resolved via `get_actual_value_of_parameter_if_secret_with_task` (handler.py:12598). Multi-field TOTP (six separate boxes) goes to `_fill_multi_field_totp_group` (handler.py:8725, plus `multi_field_totp.py`, 1,308 lines). It has its own retry budget and code-window timing.
- **Wrapper retarget.** A `<div>` or `<iframe>` wrapper whose real `<input>` is nested (for example cross-origin card widgets) is normalized to that input. It fails closed when sibling decoys exist (comment at ~handler.py:9722).
- **Idempotence.** If the field already holds the target value, return success (handler.py:~9778).
- **Selectable and typeahead probes.** For combobox-like inputs: clear, then press ArrowDown or pre-type, watching for options. The AngularJS ui-select case clicks the filtered row instead of pressing Enter, because Enter committed the wrong row (handler.py:~9890-9950).
- **Clear before fill.** Clear unless the element is a spinbutton (handler.py:~10251-10285).
- **Blocking check.** If an editable element covers the target, type into the blocker unless it rejects text fill (handler.py:~10287-10305).
- **Readback priority** (comment "card > tel > secret > masked > plain fill"):
  - **Card numbers.** Luhn-valid, 13-19 digits (handler.py:3540-3669). Read back digits only and re-enter atomically on mismatch.
  - **Phone (NANP).** `_fill_nanp_tel_with_readback` (handler.py:3331), with dial-code and E.164 fallbacks (handler.py:2939-3100).
  - **Secrets.** `_fill_secret_with_readback` (handler.py:3873). Character-by-character typing can race a caret-resetting field and rotate or truncate the value, so it reads back and re-enters atomically. It fails closed rather than submitting a wrong password.
  - **Plain native inputs.** One atomic `fill` for exact-value types (`password/text/email/search/url/""`, handler.py:3669), then dispatch `change` and `blur` (`commit_input_value`, dom.py:1284), because an atomic fill fires only `input`. Typed widgets (autocomplete, combobox, location) keep per-character typing so their option lists populate.
  - **Truncation healing.** `_heal_truncated_freetext_input` (handler.py:4271) detects prefix loss and same-length reorders (handler.py:4046-4084).
- **Autocomplete.** `input_or_auto_complete_input` (handler.py:13607). Type, wait for options, and have the LLM choose (`auto-completion-choose-option.j2`). If nothing matches, the LLM proposes up to 3 alternative values (`AUTO_COMPLETION_POTENTIAL_VALUES_COUNT=3`, constants.py:87) and then tweaks the text. `MAX_AUTO_COMPLETE_ATTEMP=1` loop (handler.py:~13634).
- **Date inputs** use `check_date_format` with an LLM reformat (handler.py:4636). A field scraped as text but live `type=date` is recovered in canonical form (handler.py:3696-3740).

**CDP dependency: partial.** `locator.fill` uses CDP `Input.insertText`, which produces trusted input events. `press_sequentially` uses `Input.dispatchKeyEvent`. Readback is JS.
**Native path:** focus via JS, then either (a) set the value through the native prototype setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`) and dispatch `input`, `change` and `blur`, which is the classic React-safe fill, or (b) send native key events for typed widgets. On macOS, `NSTextInputClient` and `insertText:` on the WKWebView behaves like `Input.insertText` (inferred). Port the readback and re-entry logic as-is: it is engine-neutral JS plus value comparison.

### 3.3 Select option (`handle_select_option_action` handler.py:11209; `normal_select` handler.py:16652)

- If the target is not selectable, look for a selectable child (handler.py:~11248).
- **Visible native `<select>`:** `locator.select_option`. Matching is deterministic first via `classify_option_match` (handler.py:718), which tries in order: normalized exact match, plural-stem match, substring match scored by the shorter length (minimum 3 characters), then word-overlap Jaccard. A unique best match is required. Then readback (`_normal_select_readback_contradicts`, handler.py:4555). The LLM `normal-select` prompt is used only on a deterministic miss.
- **Hidden backing `<select>`:** click-navigate the styled widget that replaced it.
- **Checkbox or radio target:** delegate to a click.
- **Custom dropdowns:** click to open, wait for the animation to end (0.5s), get the incremental element tree, then `sequentially_select_from_dropdown` (handler.py:14049). It supports up to `MAX_OPTION_LOADING_SCROLL_ITERATIONS=100` scrolls for lazy-loaded options (handler.py:464). Verification uses `_verify_custom_select_option_with_settle` (handler.py:14931) with a double-requestAnimationFrame settle. Optional fields with no match record an "optional miss" instead of failing.

**CDP: none** beyond click and keyboard. `select_option` itself is JS (sets `selected` and dispatches `input` and `change`). **Native:** direct.

### 3.4 Upload (`handle_upload_file_action` handler.py:11025)

1. **Anti-hallucination check.** If `file_url` does not appear in the goal or payload, try `_find_similar_url_in_text` (edit distance up to 10% of length, capped at 10, handler.py:10950-10990) to recover a corrupted copy of a real URL. Otherwise fail with `ImaginaryFileUrl`.
2. Download the file locally (`handler_utils.download_file`).
3. If the target or a child is `<input type=file>`: `set_input_files`, then `_wait_for_upload_processing` (0.5s settle plus `wait_for_page_ready` with loading-indicator, network-idle and DOM-stable checks, handler.py:10990-11022).
4. Otherwise treat it as a click with a `filechooser` listener that calls `fc.set_files` (`chain_click`, handler.py:12750-12775).

**CDP: hard** for `set_input_files` (CDP `DOM.setFileInputFiles`).
**Native path:** WKWebView's `WKUIDelegate runOpenPanelWithParameters:` lets the host answer the file chooser with URLs. Click the input with a native event, then answer the delegate with the staged file. That replaces both paths. WebKitGTK has the `run-file-chooser` signal. As a fallback for drop zones, build a `DataTransfer` with `new File([bytes])` in JS and dispatch `drop` (inferred, not in Skyvern).

### 3.5 Download (`_handle_action_with_downloads` handler.py:5205-6459)

There are about 1,250 lines here, because Playwright download events are unreliable for blob, popup and XHR downloads. The approach:

- **Baseline first.** List the download directory before the action, then diff after it.
- **Watch every source.** Listen to the page, popup pages and context child pages for `download` events.
- **Scoped XHR capture.** Capture XHR or fetch downloads in scope (`ScopedXhrDownloadCapture`, handler.py:4693, at most 64 status observations).
- **Blob URLs.** Arm blob URL retention so a page that revokes its blob immediately can still be read (5s arming timeout, handler.py:372).
- **Blocked inline PDFs.** Recover a PDF shown inline in a blocked iframe by fetching its same-origin bytes (`_recover_blocked_inline_pdf_download`, handler.py:2350, 30s budget).
- **Timeouts:** 120s with no signal plus up to 120s while a download is in flight, 600s overall (constants.py:38-40; handler.py:446-457). `.crdownload` marks an in-progress file (constants.py:89).
- **Outcomes reach the model in plain language:** `DOWNLOAD_NOT_TRIGGERED_FOLLOWUP_MESSAGE`, `..._ABORTED_...`, `..._TIMEOUT_...` (handler.py:353-371). These become `followup_message` so the next plan knows what happened.
- **Clicks without a download flag.** A "false click" in a file-download block (a click not flagged as a download that still produces one) is credited too.

**CDP: hard** in Skyvern (`Browser.downloadWillBegin` and its interceptor `cdp_download_interceptor.py`).
**Native path: better than CDP.** `WKNavigationDelegate decidePolicyForNavigationResponse` can return `.download` for `Content-Disposition: attachment` or non-renderable MIME types. `WKDownloadDelegate` gives the suggested filename, the destination decision, progress and completion, and failure with resume data. Blob and data URLs also arrive as navigation actions you can convert into downloads. Port Skyvern's *outcome taxonomy and follow-up messages*, not its interception machinery.

### 3.6 Complete, terminate and dialogs

- `handle_complete_action` (handler.py:11756) re-runs `complete_verify` unless the action is already verified. A rejection becomes `IllegitComplete`, which feeds back into the next step. In the termination-aware experiment, a verifier "terminate" verdict rewrites the action to TERMINATE.
- **JS dialogs** (`skyvern/webeye/dialog_handler.py`): an LLM `handle-dialog.j2` decides accept or dismiss for confirm and prompt dialogs, defaulting to accept. Alerts are auto-accepted, and so is `beforeunload` so that a "dismiss" cannot cancel the block's own navigation. The recent dialog messages are fed to the next planning prompt with an instruction not to retry the same INPUT_TEXT after a validation alert (extract-action.j2:72, 123). **Native:** `WKUIDelegate runJavaScriptAlertPanel/Confirm/TextInput` hand the host full control. WebKitGTK has the `script-dialog` signal.
- **Overlays and popups.** No dedicated cookie-banner remover exists in the agent path. The planner prompt says "If you see a popup in the page screenshot, prioritize actions on the popup" (extract-action.j2:10). The login prompt asks it to dismiss promo and cookie prompts first (constants.py:101-115). Mechanically, overlays are handled by the blocking-element step of the click ladder. In cached scripts, a failed selector click presses Escape, waits 0.3s and retries once before calling the AI (skyvern_page.py:~540-575). Misty can add `WKContentRuleList` cosmetic filters as a cheap win Skyvern does not have.

---

## 4. Verification and waiting

- **Animation and settle.** `safe_wait_for_animation_end` (page.py:3479) waits for the `load` state, then polls `isAnimationFinished()` every 100ms (`document.getAnimations({subtree:true})` with every `playState==='finished'`, domUtils.js:4143), with a 3s timeout. Timeouts are swallowed.
- **Page readiness** for cached replays and uploads (`wait_for_page_ready`, page.py:3519) checks, in order: loading indicators gone (spinners, skeletons, progress bars, 5s), network idle (no requests for 500ms, 3s cap), and DOM stable (no significant mutations for 300ms, 3s cap). **Native:** loading indicators and DOM stability are JS. Network idle needs a page-side `fetch`/XHR counter injected at document start in the isolated world (WKUserScript), plus `PerformanceObserver` for resource entries (inferred). WKWebView exposes no request-level hooks.
- **Did the click do anything?** The MutationObserver increment count (`_did_page_respond`, handler.py:12668).
- **Goal verification.** `complete_verify` (agent.py:7953) re-scrapes the page (with scrolling for non-CUA engines) and asks `check-user-goal.j2` for `{page_info, thoughts, user_goal_achieved}`. With `include_action_history_in_verification`, it passes the full-run action history and requires "every described action shows as completed". The verifier can run on a separate "check user goal" model (`USE_CHECK_USER_GOAL_HANDLER_FOR_VERIFICATION`).
- **Parallel verification plus a speculative next step.** `_handle_completed_step_with_parallel_verification` (agent.py:11689) runs goal verification and `_speculate_next_step_plan` (next-step scrape and LLM plan) at the same time. If the goal is met, the speculative plan is cancelled. Otherwise it is used, saving one round-trip per step. There is a 15-minute deadline (agent.py:438).

---

## 5. Retries, budgets and fallbacks

- **Per step:** up to `MAX_RETRIES_PER_STEP=5` (config.py:225, overridable per organization). After that, `summary_failure_reason_for_max_retries` (agent.py:12359) asks an LLM (`summarize-max-retries-reason.j2`) to explain the failure and map it to customer error codes. A mapped code ends the task as terminated, not failed (agent.py:12069-12200).
- **Per run:** `MAX_STEPS_PER_RUN=10` by default (config.py:195), with an LLM summary at max steps (agent.py:12226).
- **User-defined errors.** If the step output contains user-defined error codes, the task fails without retry (agent.py:12079-12108).
- **Navigation.** `navigate_with_retry` (webeye/navigation.py:311) makes up to `NAVIGATION_MAX_RETRY_TIME=5` attempts (constants.py:46), loosening the `wait_until` condition each time: `load`, then `domcontentloaded`, then `commit` (navigation.py:142-146). Permanent or blocked hosts are not retried.
- **Scripts:** a selector lookup is retried twice with a 2s shorter timeout, only on not-found or context-destroyed errors, never after an interaction failure, to avoid double-submits (`_wait_for_selector_with_retry`, skyvern_page.py:312-370).

---

## 6. Caching and self-healing ("run with code")

This is Skyvern's most distinctive reliability feature and the best fit for Misty's "improve over time" goal.

### 6.1 Recording to code
- **What gets cached:** the block types TASK, TaskV2, ACTION, NAVIGATION, EXTRACTION, LOGIN, FILE_DOWNLOAD, FOR_LOOP and WHILE_LOOP (`BLOCK_TYPES_THAT_SHOULD_BE_CACHED`, workflow_script_service.py:53). Conditionals always run through the agent. Caching is progressive: each branch that runs gets cached (`skyvern/core/script_generations/CLAUDE.md`).
- **Code generation:** `generate_workflow_script_python_code` (generate_script.py:3464) uses libcst to emit one `@skyvern.cached(cache_key=label)` async function per block. `_action_to_stmt` (generate_script.py:890) turns each recorded action into `await page.click(selector=..., prompt=<intention>, ai=...)`, `page.fill(...)`, `page.select_option(...)` and so on.
  - **Selector choice:** either `xpath=<recorded xpath>`, or in v2 a **semantic selector** built in priority order (`_build_semantic_selector`, generate_script.py:374): `aria-label`, then `placeholder` (input or textarea), then `name` (input, textarea or select), then `:has-text("<first 50 chars>")` (button or a).
  - **No usable selector:** emit `ai="proactive"` (always use the LLM) with a CRC32 `recoverable_marker_id`, so the reviewer can later upgrade the call (generate_script.py:925-945).
  - **Parameterization:** literal values are replaced with `context.parameters['field']` (values of length 4-500 only, generate_script.py:~421-428). Credentials are emitted as `context.parameters[root][sub]`. TOTP digits go through `page.get_totp_digit`.
  - **What cannot be cached:** multi-field TOTP, CLOSE_PAGE and PASTE_TEXT (generate_script.py:431-458).
- **Cache key:** the workflow's `cache_key` Jinja template rendered with the run parameters. A `"default"` or empty key becomes the first block's domain, or a detected ATS platform name, so different employers on Workday share one script. `:v2` is appended for adaptive caching (`resolve_cache_key_value`, workflow_script_service.py:410). A cached script is invalidated when the workflow's parameter key set changes (workflow_script_service.py:605).

### 6.2 Replay with AI fallback
`SkyvernPage.click` (skyvern_page.py:438) has three modes:

- `ai="fallback"`, the default: wait for the selector with retry, then `_prepare_element` (wait for visible, `scroll_into_view_if_needed`, sleep 0.15s, skyvern_page.py:371). Suppress the click if the desired state already holds, then click. On failure, press Escape and retry once. Then call `ai_click`.
- `ai="proactive"`: always use the LLM, with the selector as a hint.
- `mode="direct"`: a raw click with no fallback.

`ai_click` (real_skyvern_page_ai.py:234) re-scrapes and calls the `single-click-action` prompt with the intention, payload and element tree. It runs the full agent `handle_click_action` (so all of section 3.1 applies) and then **records an element-level fallback episode** (`_record_element_fallback_episode`, real_skyvern_page_ai.py:1079). The episode records:

- the failed selector and intention
- the element tag and text
- whitelisted attributes (`id, name, class, aria-label, placeholder, type, role, data-testid, href, value, title`)
- `css_suggestion` and `selector_options` from `compute_selector_options`

The same applies to `fill`, `select_option` and `upload_file` (skyvern_page.py:1190-1560).

**State detection inside scripts.** `page.classify(options, url_patterns, text_patterns)` (skyvern_page.py:1743) is a three-tier cascade (real_skyvern_page_ai.py:840-900):

1. URL regex, no LLM cost
2. All-substrings match on the page's extracted text, no LLM cost
3. A small LLM `page-classify` call, as the last resort

Every `classify` must have an `else: await page.element_fallback(navigation_goal=...)`. That starts the agent **from the current page** for at most 5 steps instead of re-running the block (skyvern_page.py:3661).

**Detecting a broken cached plan.** In `run_task` (script_service.py:2456), any exception escaping the cached function (a selector and AI both missed, a validation failed, an explicit terminate) triggers `_fallback_to_ai_run` (script_service.py:1597). It marks the script step failed, checks that the browser is alive and `ai_fallback` is enabled, then re-runs the block with the full agent (`fallback_type="full_block"`, ~script_service.py:1806). Inline regeneration after a successful fallback is **deliberately disabled** (`_regenerate_script_block_after_ai_fallback` returns early, script_service.py:2083-2088). Improvement goes through the reviewer instead.

### 6.3 Self-healing reviewer
After a run, the workflow service collects that run's unreviewed episodes. It also loads up to 20 historical reviewed episodes and branches not hit for 90 days ("stale branches") (forge/sdk/workflow/service.py:~20300-20420). Then it calls `ScriptReviewer.review_fallback_episodes` (script_reviewer.py:539). The design principles in its docstring (script_reviewer.py:528-536): existing code worked before, so only **add** branches; generate the full function; check it with `compile()`; and write a new version, keeping old versions as rollback targets.

- **Triage.** An episode where the fallback also failed goes to `script-failure-triage.j2`, which answers `CODE_FIXABLE` or `NOT_CODE_FIXABLE` (script_reviewer.py:979). Code-fixable means wrong selectors, unhandled widgets, timing, or one stuck field. Not code-fixable means site down, CAPTCHA or bot block, auth failure, missing data, rate limits or crashes. Not-fixable episodes are marked reviewed and skipped. If the triage call itself fails, the episode is let through.
- **Reviewer prompt** (`script-reviewer.j2`), main rules:
  - keep code short
  - every `classify` has an `else` that calls `element_fallback`
  - `text_patterns` must not contain PII
  - every `ai='fallback'` call needs a `selector=`, built with `label:has-text("X") input`
  - accumulate variants as comma-separated selectors, first match wins
  - remove selectors known to fail, and drop ambiguous label selectors on forms with repeated rows
  - broaden `button:has-text` to `input[type=submit], a, [role=button]`
  - if the same selector worked in the agent, copy the agent's preceding steps (dismiss a popup, wait 3s)
  - upgrade marked proactive calls to `selector + ai='fallback'`
- **Patching and validation.** Blocks are spliced into `main.py` and compiled (workflow_script_service.py:1692-1850, 2084, 2125). There is an LLM repair step for a broken `main.py` (`_llm_fix_broken_main_py`, :1852). Validators check for proactive misuse and missing selectors (`script_validators.py`).
- **Reliability scoring** (schemas/self_heal.py:47-48, 231). Over the last 20 terminal runs, with at least 10 needed to score: `action_needed` if 3 or more of the last 10 runs healed, or the heal rate is at least 0.20, or 2 or more runs hit "floor" (the full agent). `watch` if 2 or more runs healed, or 2 consecutive runs healed. Otherwise `healthy`.

**CDP dependency: none.** This is all orchestration around selectors and LLM prompts. Selectors would need a CSS + `:has-text` engine in Misty's facade. Port Playwright's selector semantics in JS: `:has-text` is a case-insensitive substring match on normalized textContent (inferred from the prompt's description).

**How Misty should adapt it** (recommended): instead of Python code, store per-site **action recipes**. A recipe is the action list with semantic selectors, intent strings and parameter bindings, keyed by `(normalized domain or platform, task template hash)`. Replay each step selector-first and fall back to the model. Log every fallback as an episode with the element signature. Run a periodic reviewer (any engine through Misty's proxy) that only adds alternatives and branches. The 3-tier classify (URL regex, text, then LLM) is cheap and directly reusable.

---

## 7. Auth, sessions and credentials

- **Secret placeholders.** `register_secret_value` stores the real value under a random id (`RANDOM_SECRET_ID_PREFIX` plus 4 random characters, `forge/sdk/workflow/context_manager.py:1708-1720`). The LLM sees only the id. Handlers resolve it at type time (handler.py:12572-12610). `ImaginarySecretValue` is raised when the model invents a placeholder. Masked readback recognizes `•●·*` mask characters (handler.py:3681).
- **Vaults:** Bitwarden (CLI-based, with a session cache, a 180s login timeout and a 4h maximum session lifetime: `forge/sdk/services/bitwarden.py`; config.py:494, 509; plus a bundled `bitwarden-cli-server/`), 1Password, AWS, Azure, GCP, a custom vault and Skyvern's own vault (`forge/sdk/services/credential/`).
- **TOTP/OTP.** `resolve_otp_value` (services/otp_service.py:926) checks sources in priority order:
  1. a code in the navigation payload
  2. a code generated from the credential's TOTP secret, optionally waiting for a fresh 30s window when `min_remaining_seconds` is set (:765)
  3. polling a `totp_verification_url` webhook or an email inbox, every 10s for up to `VERIFICATION_CODE_POLLING_TIMEOUT_MINS=15` (config.py:868; poll loop :1004-1070). Codes older than the run start are rejected.

  The planner flags verification pages with `place_to_enter_verification_code`, `should_enter_verification_code` or `should_verify_by_magic_link`. `handle_potential_OTP_actions` (agent.py:12926) then injects the code or follows the magic link. If the model tries to give up on a verification page that has an OTP source configured, the code resolver is forced to run anyway.
- **Login block.** `DEFAULT_LOGIN_PROMPT` (constants.py:101) covers dismissing popups, email-first two-step flows, separate username and password fields, and 2FA. When a saved browser profile is loaded, the goal is rewritten to "check if already logged in; if so complete immediately, else log in" (forge/sdk/workflow/service.py:11395-11410).
- **Persistent sessions and profiles.** Profiles are Chromium user-data-dir archives with junk directories ignored (`webeye/browser_profile_utils.py`). **Session-only cookies** (expiry -1 or 0) are dropped from user-data-dir snapshots, so Skyvern snapshots them into a `.skyvern_session_cookies.json` sidecar and re-injects them at boot (`webeye/session_cookies.py:1-40`). "Living-profile banking" (keeping cookies fresh after successful logins) is cloud-only.
- **Signed-out detection.** `SIGN_IN_FORM_SCRIPT` defines a sign-in form as exactly one visible password field not marked `new-password` (`forge/sdk/workflow/models/code_block_recorder.py:91-104`, 0.5s timeout). Failures on such a page are tagged `SIGN_IN_FORM_VISIBLE`. When the run started from a saved profile, the tag becomes `SAVED_PROFILE_SIGNED_OUT` (failure_classifier.py:718-751).

**Native path for Misty (high value, low CDP dependency):**
1. Keep using a per-profile `WKWebsiteDataStore(forIdentifier:)` (macOS 14+) for the real signed-in sessions.
2. Port the session-cookie sidecar: at profile close, `WKHTTPCookieStore.getAllCookies`, filter `isSessionOnly`, save. At open, `setCookie` before the first navigation. WebKit also drops session cookies when the process exits (inferred), so this probably affects Misty today.
3. Port `SIGN_IN_FORM_SCRIPT` as a post-failure probe and as a pre-task "are we still signed in?" check, so a run can say "profile X is signed out of site Y, please sign in in Misty" instead of failing silently.
4. Never put credentials in prompts. Misty's design (sessions only, no credential typing) already avoids most of this. If TOTP is ever needed, use the placeholder pattern.

---

## 8. Anti-bot and CAPTCHA

- In OSS, `SOLVE_CAPTCHA` only logs "you have 30 seconds" and sleeps 30s (`handle_solve_captcha_action`, handler.py:6924-6936).
- `solve_challenge` (webeye/utils/captcha_solver.py:343) runs inside a 110s budget (`_LADDER_BUDGET_SECONDS`, :130):
  1. detect a vendor challenge (Cloudflare host matching, :266) and hand it to `AGENT_FUNCTION.run_vendor_challenge_handler`, which is cloud-only
  2. otherwise a DOM-checkbox step: click a visible challenge checkbox, then a continuation button
  3. a reCAPTCHA step: click `#recaptcha-anchor` inside the trusted anchor iframe, then check `aria-checked` and the token textarea (:468-560)
- The planner is told CAPTCHA tokens expire in about 2 minutes, so it should fill the form first and solve just before submit (extract-action.j2:26).
- Unsolved-challenge "receipts" become evidence for failure reports (`forge/antibot_evidence.py`).
- **Native path:** Misty's advantage is the user's real WebKit profile with real cookies and history. That passes most passive bot checks better than headless Chromium. Port the detection (vendor host and iframe matching, checkbox click with native trusted events), and route an unsolved challenge to **human handoff in Misty's UI**. Do not use a solver service: CAPTCHA bypass is out of scope.

---

## 9. Failure classification

- **Heuristic categories.** `classify_from_failure_reason` (forge/failure_classifier.py:185) keyword-matches failure text and exception types into 19 categories (`FailureCategory`, :21-40): ANTI_BOT_DETECTION, PROXY_ERROR, BROWSER_ERROR, BROWSER_SESSION_EXPIRED, NAVIGATION_FAILURE, PAGE_LOAD_TIMEOUT, ELEMENT_STATE_TIMEOUT, AUTH_FAILURE, LLM_ERROR, CREDENTIAL_ERROR, DATA_EXTRACTION_FAILURE, ELEMENT_NOT_FOUND, WRONG_PAGE_STATE, MAX_STEPS_EXCEEDED, BUDGET_EXHAUSTED, LLM_REASONING_ERROR, INFRASTRUCTURE_ERROR, WEBSITE_ERROR, PARAMETER_BINDING_ERROR.
- **Matching details:**
  - selector payloads like `locator('#password')` are stripped before the auth-keyword scan, so a selector name is not mistaken for a login failure (:51)
  - 429 and 403 wording is "site throttling", never an LLM error (:63-67)
  - integration-block prefixes (sheets, HTTP, vault) are never labeled bot protection (:69-115)
- **LLM categories.** At max retries or max steps, the LLM summary may return categories, and the source (`llm` or `code_level`) is recorded.
- **Lesson:** Misty's harness should emit a typed `failure_category` per run (heuristic first, LLM summary second). That feeds both the self-healing triage (section 6.3) and the benchmark error analysis.

---

## 10. The `evaluation/` folder

- **Contents:**
  - WebVoyager: `webvoyager_tasks.jsonl` (635 lines), `webvoyager_reference_answer.json`, `webvoyager_outdated_tasks.jsonl` (7), and a "compute use" subset (49)
  - Odysseys: 200 tasks with rubrics, MIT
  - per-site Markdown results with links to `eval.skyvern.com` runs (`evaluation/results/*.md`, 15 sites)
- **Pipeline:**
  1. `create_webvoyager_task_v2.py` loads each case. It runs `check-evaluation-goal.j2`, which **rewrites booking dates to fall within the next two months** if the goal is a booking with a date, and sets `is_updated=True`. Then it queues a Task V2 (planner) run.
  2. `eval_webvoyager_task_v2.py` polls in batches of 5. A non-completed run is a fail. A completed run goes to `Evaluator.eval_skyvern_workflow_run`.
  3. The judge (`evaluation/core/__init__.py`, `_execute_eval`; prompt `evaluate-prompt.j2`) receives the **final screenshot only**, the extracted answer and the reference answer, which is marked "for reference only" when outdated. It returns `SUCCESS` or `NOT SUCCESS`. Text prevails over the screenshot when they conflict. The judge model is whatever `app.LLM_API_HANDLER` is configured to use.
- **Lessons, given the user's rule that the judge must follow the benchmark's rules:**
  1. Skyvern's WebVoyager judge is its **own** prompt and model, using only the final screenshot. The official WebVoyager auto-evaluator uses GPT-4V over the trajectory's last screenshots plus the answer (inferred from upstream WebVoyager; not in this repo). Skyvern's numbers are therefore not strictly comparable. Misty should vendor the benchmark's own judge prompt and model.
  2. Rewriting dates is a reasonable fix for stale tasks, but it changes the task. If Misty does it, report it as a separate "date-refreshed" column.
  3. Skyvern itself vendors the upstream Odysseys full-trajectory judge "byte-identical" (`pyproject.toml:318` excludes `scripts/benchmark/evaluators/_odysseys_upstream_full_traj.py` from lint for that reason). The `scripts/benchmark/` directory is **not in the OSS tree**. That confirms the right practice: run the upstream judge unmodified.
  4. The per-site results tables publish status per task with run links. That is good transparency to copy. The `completed` count in those tables is run status, not necessarily the judge's verdict (inferred).

---

## 11. Mapping to Misty's native webview, with priorities

| Mechanism | Skyvern location | CDP dependency | Native wry/WKWebView path | Value |
|---|---|---|---|---|
| Click fallback ladder with hit-test and blocker handling | handler.py:12701; dom.py:874,1525; domUtils.js:726; page.py:496 | partial | Isolated-world JS for the hit test and rect; native NSEvent click; synthetic event sequence as the last step | high |
| Desired-state toggle guard | handler.py:7777; skyvern_page.py:394 | none | JS reads `checked`/`aria-checked`/`aria-selected` | high |
| MutationObserver "did it respond", plus dropdown follow-up | domUtils.js:3762-3972; handler.py:8253 | none | Same JS | high |
| Input readback, atomic re-entry, commit events | handler.py:3540-4377, 9574-10950; dom.py:1274-1300 | partial | Native-setter fill plus input/change/blur; native key events for typed widgets | high |
| Deterministic option matching, then LLM | handler.py:718; 16652 | none | Same | high |
| Stale-target remap and batch stop | handler.py:6748-6922 | none | Same JS marker checks | medium |
| Step retry with failure feedback, follow-up messages | agent.py:6454-6910, 12069; responses.py | none | Harness or MCP result schema | high |
| complete_verify, parallel verification and speculative planning | agent.py:7953, 11689 | none | Engine-side via Misty's proxy | medium |
| Animation, loading and DOM-stable readiness | page.py:3479-3620; domUtils.js:4143 | partial (network idle) | JS plus an injected fetch/XHR counter | high |
| Upload via file chooser | handler.py:11025, 12750 | hard | `WKUIDelegate runOpenPanel` / GTK `run-file-chooser` | high |
| Download outcome taxonomy | handler.py:353-371, 5205-6459 | hard | `WKDownloadDelegate` (simpler and more reliable) | medium |
| JS dialog policy | dialog_handler.py | partial | `WKUIDelegate` alert/confirm/prompt | medium |
| Recorded recipe plus selector-first replay with AI fallback | generate_script.py; skyvern_page.py:438; real_skyvern_page_ai.py:234 | none | Store recipes as JSON; Misty facade implements CSS + `:has-text` | high |
| 3-tier classify (URL, text, LLM) | real_skyvern_page_ai.py:840-900 | none | Same | high |
| Fallback episodes, triage, additive reviewer, reliability states | script_reviewer.py:528-1036; schemas/self_heal.py:231 | none | Same, with the engine as reviewer | high |
| Session-cookie sidecar | webeye/session_cookies.py | partial (Playwright cookies API) | `WKHTTPCookieStore` get/set, filtered on `isSessionOnly` | high |
| Sign-in form probe and "saved profile signed out" | code_block_recorder.py:91-112; failure_classifier.py:718-751 | none | Same JS | high |
| Secret placeholder substitution | context_manager.py:1708; handler.py:12572 | none | Same (if credentials are ever used) | low (Misty is session-only) |
| CAPTCHA checkbox and reCAPTCHA anchor click | captcha_solver.py:317-560 | partial | Frame-scoped JS plus a native click; otherwise human handoff | low to medium |
| Failure categories | failure_classifier.py:21-235 | none | Port the categories and heuristics | medium |
| Playwright-shaped engine facade | skycdp/facade/*.py | (the abstraction itself) | Build `MistyPage`/`Locator` over wry IPC | high |

**Recommended order of work:**
1. Build a Playwright-shaped facade (`click/fill/press/select_option/set_input_files/evaluate/locator`) over wry IPC, modeled on `skycdp/facade/elements.py` and `locator.py`. Native trusted input sits underneath it.
2. Port the click and input ladders with their readback checks.
3. Add typed action results (`success`, `stop_execution_on_failure`, `skip_remaining_actions`, `followup_message`, `failure_category`).
4. Add the session-cookie sidecar and the sign-in probe.
5. Add recipe recording with selector-first replay, fallback episodes and the additive reviewer.
6. Vendor the benchmarks' upstream judges unmodified.
