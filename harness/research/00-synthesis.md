# 00. Synthesis: the plan of record for Misty's browser harness

This plan pulls together the seven research reports in this folder:

- `10-skyvern-agent-loop.md`, `11-skyvern-page-representation.md`, `12-skyvern-reliability.md`
- `20-browser-use-page-state.md`, `21-browser-use-agent-loop.md`, `22-browser-harness-and-browsercode.md`
- `30-misty-current-harness.md`

I spot-checked their main claims against the source. Nothing was run.

- **Skyvern** checkout: commit `cc5ef72bd9fe` (2026-11-14).
- **browser-use** checkouts: 1.0.5 at `e717df1`, and 0.13.14 for the removed DOM engine.
- **browser-harness** and **browsercode**: also read.
- **Misty**: `misty/` and this repository.

Path prefixes used below are `skyvern/`, `browser-use/`, `bu-0x/`, `browser-harness/`, `browsercode/`, `misty/` (the app) and `harness/` (this repository). "(inferred)" marks a conclusion I drew rather than read.

## What the spot-checks confirmed

| Claim | Where it was confirmed |
|---|---|
| Skyvern v3 guard thresholds: perception stall 6/15, action loop 3/8, page-state stall 8/12, read retention 20k/40k chars | `skyvern/skyvern/forge/taskv3/loop.py:1009-1130` |
| v3 budgets: 80 turns, 300 tool calls, 1800 s, an action-step floor of 24 | `taskv3/engine.py:113-132` |
| The finish judge never sees the agent's own reason. It gets an 8-call trail and a page read capped at 16,000 chars | `taskv3/goal_check.py:1-32` |
| The saved-profile login rewrite | `skyvern/forge/sdk/workflow/service.py:11398-11410` |
| Inline script regeneration is disabled | `skyvern/services/script_service.py:2083-2088` |
| `RELIABILITY_WINDOW = 20` | `skyvern/schemas/self_heal.py:47` |
| The license carve-out | `README.md:589-590` |
| browser-use `settle`: 800 ms action cap, 80 ms DOM quiet, 3,000 ms while loading, 1.5 s long-poll cutoff | `browser-use/browser_use/ax.py:408-450` |
| browser-use state truncation keeps 80% head and 20% tail | `ax.py:657-665` |
| The BU Bench comparison table | `browser-harness/README.md:79-97` |
| Misty re-sends the whole runtime with every call (the six `js/` files total 114,127 bytes) | `misty/src-tauri/features/browser/agent_pages/page_agent/mod.rs:125-128`, `harness/crates/page-runtime/src/lib.rs:13-25` |
| Native typing is one `insertText:replacementRange:` call | `misty/src-tauri/features/browser/input/macos/native_action.rs:146-156` |
| Engines do not get `browser.upload` | `misty/src-tauri/features/engines/mcp.rs:53-67` |
| `target["authentication"] == "required"` is checked in four places and set nowhere (grep of `src-tauri`) | the four check sites |

---

## 1. How each system gets its results

### 1.1 Skyvern: the harness owns the model, and distrusts it

Skyvern's results come from a **heavily defended harness wrapped around a model it calls itself**. It has four layers.

**1. Whole-page perception, built in JS and serialized compactly.**

- `skyvern/skyvern/webeye/scraper/domUtils.js` (4,201 lines) walks the DOM, including open shadow roots. It keeps only interactable, structural or text-bearing nodes and collapses wrapper elements away.
- It stamps short base-62 `unique_id`s on interactables (`domUtils.js:1898-1964`). Those ids are reused across re-scrapes of the same document.
- Python serializes the result to pseudo-HTML:
  - about 28 whitelisted attributes;
  - custom dropdowns renamed to `<select>`;
  - inline `<option index=N>`;
  - long hrefs hashed (`skyvern/webeye/scraper/scraped_page.py:66-135`, `scraper.py:159-203`).
- Up to 10 plain scrolling screenshots go alongside the text. The old set-of-marks overlay is deprecated (`scraper.py:359-362`).
- A staged token budget degrades the tree in steps: 100k tokens, then an economy tree, then the first two-thirds with popups moved to the front, then a hard ceiling of 180k (`skyvern/utils/prompt_engine.py:72-390`).
- The interactability rules in `isInteractable` (`domUtils.js:1251-1474`) are years of hand-tuned, site-specific knowledge. They cover jQuery and Angular handlers, DevExpress, select2, Kendo, Google Places and hover-cursor stylesheets.

**2. Defensive execution: ladders backed by readbacks.**

- `skyvern/webeye/actions/handler.py` is 17.6k lines.
- **Click ladder.** A click tries up to 8 strategies (`chain_click`, `handler.py:12701`):
  1. follow the href;
  2. a normal click;
  3. the `for=` target of a label;
  4. bound labels;
  5. a coordinate click after a hit test;
  6. clicking the blocking element;
  7. a synthetic event sequence, accepted only if a MutationObserver saw the page respond.
- **Text input** has readback and atomic re-entry, with special paths for cards, phone numbers, secrets and truncation healing (`handler.py:3331-4377`, `9574-10950`).
- **Desired-state toggles.** A click on a box that is already checked is suppressed (`handler.py:7777`).
- **Mini-agents for hard widgets.** Custom selects, autocomplete and date pickers each have their own small prompt that sees only the elements that newly appeared after the trigger was opened (`domUtils.js:3908-4141`, `custom-select.j2`, `auto-completion-*.j2`).
- **Failures become text.** Every failure is converted into an `ActionFailure` carrying `followup_message`, `stop_execution_on_failure` and `skip_remaining_actions`. That text is fed into the next plan (`handler.py:6459-6669`, `agent.py:6454-6910`).

**3. Completion is never taken on the model's word.**

- A `COMPLETE` is re-checked on a freshly re-scraped page by a separate prompt (`handler.py:11756-11836`, `check-user-goal.j2`).
- Steps without a decisive action are verified in parallel (`agent.py:11689`).
- The v3 finish judge sees only evidence: the last 8 tool results, a fresh page read and a screenshot. It never sees the agent's claims (`taskv3/goal_check.py`).
- Termination is conservative. The prompt lists explicit do-not-terminate cases, uses a three-way verdict, and requires terminate reasons to quote page text (`task_v2.j2:29-52`).

**4. Structure for long horizons and repetition.**

- **The v2 planner** keeps a `required_subgoals` checklist that carries forward between iterations. Its rules: navigate tasks never extract; repeated work becomes loops; it switches to a wrap-up mode near the budget; and a goal that hit max steps is re-planned more specifically (`task_v2.j2:6-141`).
- **The v3 tool loop** has numeric guards against stalls and loops, progress-gated budget extensions, and size-based elision of old page reads (`loop.py:995-1145`).
- **Cached scripts** replay selector-first with the AI as a fallback. Fallback episodes feed an additive reviewer, and a 20-run reliability score tracks each script (`skyvern/core/script_generations/`, `script_reviewer.py`, `schemas/self_heal.py`).

**What depends on CDP.** Almost none of this. The CDP dependencies are:

- input dispatch (Playwright locators);
- per-frame evaluation and the mapping from frame to `<iframe>` element;
- `Page.createIsolatedWorld` in v3;
- download interception;
- `setInputFiles`;
- network idle.

### 1.2 browser-use: the model writes code against the browser, and verifies itself

browser-use has shipped two designs. Both are relevant.

**0.x: a DOM-dump engine** (`bu-0x/browser_use/dom/`, about 6,200 lines). This design produced the well-known results.

- It merges three CDP sources: `DOM.getDocument(pierce)`, `DOMSnapshot.captureSnapshot` (with paint order, rects and computed styles) and `Accessibility.getFullAXTree`.
- It decides interactivity with an ordered list of 11 rules (`clickable_elements.py:4-246`).
- It drops nodes that paint order shows to be occluded (`paint_order.py:146-225`).
- It collapses descendants that lie 99% inside a link or button (`serializer.py:772-923`).
- It prints an indented tree with `[backendNodeId]` handles and `*` marks on elements new since the last step.
- It adds compound-control parts, format hints and scroll hints.

**1.0: code as action** (`browser-use/browser_use/agent/loop.py`, `agent/prompt.py`, `ax.py`).

- The agent is a general coding agent with one `python(code)` tool. The tool runs in a persistent REPL that has browser-harness primitives and raw CDP.
- There is no planner, memory field, loop detector or failure counter (`MIGRATING.md:3-4`, `agent/service.py:79-157`).

Five things make 1.0 robust:

1. **Many operations per model turn.** The prompt forbids spending a turn on a lone peek (`prompt.py:36`). The model also decides what enters its context.
2. **Act and observe in one call.** In ultrafast mode every action prints one verdict line: `navigated to X`, `page changed` or `no change`. A compact accessibility-style state, with `*` marking new ids, is appended automatically (`ax.py:767-803`, `repl/worker.py:1201-1206`).
3. **Precise refusals.** `POINT_JS` checks plus naming the element on top give errors like "Target covered by [id] dialog "Cookies"; nothing was clicked" (`ax.py:199-218`, `704-757`).
4. **Event-based settle, never a fixed sleep.** Thresholds: 80 ms DOM quiet, an 800 ms cap, 3,000 ms while loading, and requests older than 1.5 s ignored as long-polls (`ax.py:408-450`).
5. **Delivery discipline.**
   - A forced "deliver now" turn at 90% of the budget.
   - A placeholder answer, an answer naming missing files, or a split delivery is refused once.
   - `checkpoint(partial=True)` saves partial results that survive timeouts.
   - `finish_from_repl` delivers data by reference.
   - A `success` flag that says "never fill it from memory" (`loop.py:87-416`, `worker.py:742-751`).

Reliability is mostly moved into the model and the prompt: "verify the actual outcome after every mutation". A post-run judge writes per-site "gotchas", but nothing feeds them back into later runs (`agent/judge.py`, `service.py:622`). browser-harness adds agent-written per-domain skill files that are surfaced on navigation (`browser-harness/src/browser_harness/helpers.py:152-157`).

### 1.3 Where they differ, and what that means for Misty

| | Skyvern | browser-use 1.0 |
|---|---|---|
| Who owns the loop | The harness. It calls the LLM with a fixed schema (v1/v2) or native tools (v3). | The model. The harness is a library. |
| What enters context | A whole-page tree every step, with history of one step only. "The page is the state." | Whatever the model prints. The state is compact, 3,000 chars by default. |
| Where reliability lives | Harness-side ladders, readbacks, mini-agents | The model's own code and verification habits, plus precise refusals |
| Completion | An independent evidence-only verifier | Self-verification, plus a judge after the run (not a gate) |
| Hard widgets | Dedicated sub-prompts over the elements that newly appeared | The model types, looks, then clicks |
| Self-improvement | Compiled scripts, fallback episodes, an additive reviewer | Gotchas (not fed back); domain skills in browser-harness |

**The key external data point.** On 100 BU Bench V2.1 tasks with Codex driving, Browser Harness scored 60.4, Playwright MCP 60.0 and Chrome DevTools MCP 61.0. Every paired 95% confidence interval contains zero. Median input tokens were 2.1M, 4.4M and 6.7M respectively (`browser-harness/README.md:79-97`).

When a coding agent drives, the harness changes **cost and robustness** more than raw capability. Misty is in exactly that setting: Claude Code drives over MCP. The plan therefore puts four things first:

- **token-efficient act and observe;**
- **verified effects and precise failures;**
- **evidence and delivery discipline;**
- **composite widgets**, which is where Skyvern's harness-side intelligence clearly pays off.

Exotic perception comes after those.

**Misty is architecturally Skyvern v3 with browser-use's tool philosophy.** Engines call tools; the harness never calls an LLM. So:

- Skyvern's prompts become **tool descriptions, tool-result text and the browser skill**.
- Its sub-calls become **deterministic code, decision requests returned to the engine, or rare `engine.ask` calls through Misty** (section 6).

---

## 2. Comparison across dimensions

| Dimension | Skyvern | browser-use (0.x / 1.0) | BrowserCode / browser-harness | Misty today |
|---|---|---|---|---|
| **Page representation** | Pseudo-HTML of kept nodes from `domUtils.js`, whole page (only the X axis is checked, `domUtils.js:575-589`), staged 100k/180k token budget, plus up to 10 scrolling screenshots | 0.x: indented tree, ±1000 px viewport margin, paint-order occlusion, 99% containment collapse, 40k-char head cut. 1.0: flat AX lines `[id] role "name" = value states`, visible-text filter, 3,000 chars with an 80/20 cut | None. The agent queries `Accessibility.getFullAXTree` in code and filters it | Playwright-style YAML AX tree from a DOM walk with simplified accname (`harness/crates/page-runtime/js/page_tree.js:64-176`), menu caps, popup and error notes, 24k default, cross-origin frames spliced. No rects, no viewport split, no new-element marks |
| **Element identity** | `unique_id` DOM attribute, base-62, frame prefix, reused within a document; `structural_identity` hash for remaps (`scraper.py:225-348`) | CDP `backendNodeId`; `*` new markers | `backendNodeId`, coordinates | `WeakMap` refs `eN` stable within a document, plus fingerprint `[tag, role, name, type, href]`, documentId and frame chain. Stale access fails loudly (`page_core.js:181-230`). `{role, name, index}` locators |
| **Action execution** | Playwright input plus ladders (8 click strategies, fill readback, deterministic option matching then LLM, `handler.py:718`) | CDP coordinate press/release; insertText for all but the last char, which is a real key (`ax.py:836-847`); select set in JS | Coordinate clicks through CDP; `fill_input` for framework fields | Native AppKit events posted to the view after 5-point hit-test checks. `execCommand` fill falls back to the value setter. Native `insertText` for the whole string. Script-only input inside cross-origin frames (`step/checked.rs:17-22`) |
| **Verification** | MutationObserver "did it respond", value readback, checkbox before/after, `complete_verify`, v3 evidence-only judge | Verdict line (navigated / changed / no change), value readback "(field now shows …)" | Prompted: "verify with a targeted js()" | `retained` for fills and checked state only. A native click reports `verified:false` (`native_action.rs:23-28`). No effect verdict |
| **Recovery** | Step retries ×5, failure text to the next plan, stale-target remap, Escape-and-retry in scripts | Model-driven; REPL restart; reattach; precise covered errors | Stale-session self-repair, retried once (`daemon.py:776-809`) | Dismiss popup and retry on covered; link fallback via `location.assign`; native re-type when a fill is not retained; one stale-ref re-read in `browser.run` |
| **Long-horizon planning** | v2 subgoal checklist, loops, wrap-up mode; v3 guards and budget extensions | None in 1.0 (the engine plans); compaction template | Engine TodoWrite | None in the harness; left to the engine |
| **Evidence and deliverables** | Screenshots per step, extraction with schema, run artifacts | Screenshots auto-attached (4 per cell), checkpoint/partial, delivery guards, file-link checks | Screenshot tap to a judge dir, recordings with secret scrubbing | Step pictures throttled to one per 1.2 s, >400 KB dropped, macOS only (`run_control/step_pictures.rs:19-123`). No checkpoint or delivery checks |
| **Auth and sessions** | Profiles, a session-cookie sidecar, saved-profile login rewrite, sign-in-form probe, `SAVED_PROFILE_SIGNED_OUT` | Attach to the user's Chrome; secrets by name with origin-checked typing | Attach to the running Chrome profile; "stop and ask" at walls | Per-profile `WKWebsiteDataStore(forIdentifier:)`, the profile taken from the calling window (`pages/create/mod.rs:31-94`). The auth barrier is dead code. The debug app uses a *copy* of the store (`profile_store.rs:51-104`) |
| **Anti-bot** | OSS sleeps 30 s; vendor solvers are cloud-only; checkbox and reCAPTCHA anchor clicks | Cloud solver only | None | A real WebKit profile with a Safari user agent; challenge detection with a 20 s wait-out; hand-off to the person |
| **Caching and self-healing** | Compiled scripts per block, AI fallback per element, episodes, triage, additive reviewer, 20-run reliability | Gotchas logged only | Agent-written domain skills and helpers | Locators only; site lessons hard-coded in comments and heuristics |

---

## 3. Ranked gaps in Misty's harness

The ranking is by expected effect on BU Bench V2.1 and Odysseys scores and cost, with Opus 5.5 driving through Claude Code. Each gap gives:

- **Build:** what to build;
- **Source:** where it is derived from, and the license;
- **CDP:** how much the source depends on CDP, and the native-webview way to do it;
- **Impact:** the expected effect.

### G1. Act and observe in one call, with a compact diffed state

**Build:**

- Every `browser.steps`/`page.act` result starts with one verdict line per step, for example `[ok] click e12 button "Save" -> page changed`. The possible verdicts are `navigated to <url>`, `page changed` and `no change`.
- The verdict is computed from a per-document random token plus a filtered mutation counter: no-op attribute writes are ignored, and style churn is debounced to one change per element per 200 ms.
- The state after a step is a **diff-aware compact snapshot**, about 4,000 chars:
  - `*` on refs new since the last read;
  - a header with url, title, loading state and dialogs;
  - head-80% / tail-20% truncation.
- A full 12,000-char tree is sent only after a navigation or on request.

**Source:** `browser-use/browser_use/ax.py:109-172` (`PROBE_JS`), `:490-668` (state format and cut), `:767-803` (verdict) and `repl/worker.py:1201-1206`. All MIT.

**CDP:** None for this part. The probe is pure JS, and Misty's `WeakMap` refs already give stable ids.

**Impact:** High. It removes "look" turns and cuts input tokens, which is where coding-agent harnesses differ most (2.1M against 6.7M tokens). The `no change` verdict also turns silent misclicks into visible failures.

### G2. Evidence, finish gate and delivery discipline

**Build:**

1. In benchmark mode, take an **unthrottled capture after every browser tool event**. Drop no images; downscale instead. Write `events.jsonl` with secret-scrubbed URLs.
2. Add a `browser.finish_check` tool (described in the skill as mandatory before declaring done). It:
   - re-observes after a settle;
   - returns an **evidence packet**: the last 8 action results with their effects, the fresh page read capped at 16k, and a capture;
   - applies Skyvern's rules: absence is not contradiction, a search-box echo is not the effect, a read taken before the last action does not count.
3. Add `browser.checkpoint {name, value, partial}`, which writes to the run's `outputs/`.
4. The run controller injects "deliver the verified result now" at 90% of the task budget. It refuses once a final answer that is a placeholder or names a missing file.

**Source:**

- `skyvern/skyvern/forge/taskv3/goal_check.py:1-32` and `prompts/skyvern/taskv3-goal-check.j2`, AGPL-3.0.
- `browser-use/browser_use/agent/loop.py:87-96`, `:150-153`, `:219-281`, and `repl/worker.py:742-751`, MIT.
- `browser-harness/src/browser_harness/recorder.py:44-67`, MIT, for URL scrubbing and password masking.

**CDP:** None. Captures use `WKWebView takeSnapshot`.

**Impact:** High.

- The benchmark judges score from screenshots and trajectories. Today some steps have no picture at all (`harness/benchmarks/bu-bench/README.md`, "How it differs").
- Partial credit on Odysseys rubrics depends on always delivering *something* that has been verified.

### G3. Verified actions, recovery ladders and typed failures

**Build:**

- **Typed outcome on every step.** Each `page.act` returns `{status: done|unchanged|failed|refused|uncertain, dispatched, path, effect{navigated, docChanged, mutations, valueNow, checkedNow}, failure{code, category, followup, stopBatch, skipRemaining}}`.
- **Click ladder**, with each rung gated by whether the page responded:
  1. native click at a hit-tested point;
  2. the `for=` target of a label, or its child input;
  3. the single deepest interactable descendant of a disabled wrapper;
  4. an interactable blocker that is the target's parent or sibling;
  5. the scripted pointer sequence, accepted only if mutations were seen.
- **Desired-state** for check, uncheck and toggles.
- **Post-dispatch timeouts count as success.** Never re-click after a dispatch, to avoid double submits.
- **Typing:**
  - native `insertText` for all characters but the last;
  - a native keyDown/keyUp for the last character;
  - read the value back, and re-enter atomically if it differs;
  - a per-character native key mode for OTP-style and keydown-validated fields.
- **Failure categories** from a fixed taxonomy, matched heuristically first.

**Source:**

- `skyvern/skyvern/webeye/actions/handler.py:7777`, `:12668-13075`, `:3540-4377`, `:6459-6669`; `skyvern/webeye/utils/dom.py:497,912`; `skyvern/forge/failure_classifier.py:21-235`. All AGPL-3.0.
- `browser-use/browser_use/ax.py:704-861`, MIT.

**CDP:** Partial in the sources, through Playwright and CDP `Input.*`. Native: AppKit/GTK events (already present), JS hit tests, and `insertText:` plus `keyDown` on the first responder.

**Impact:** High on form-heavy tasks. It turns false successes into recoverable failures.

### G4. Composite widget tools: combobox, custom select, date picker

**Build:**

- An "emerging elements" observer: arm a MutationObserver before the trigger, then return only the new or revealed subtrees.
- `pickers.choose` becomes:
  1. open the widget;
  2. diff what appeared;
  3. match deterministically (exact, then plural stem, then substring scored by the shorter length with a 3-char minimum, then word-overlap Jaccard; a unique best match is required);
  4. scroll a virtualized list by 85% per step, up to 100 times;
  5. commit;
  6. verify with a double-requestAnimationFrame settle and a readback.
- If no match is unique, return a **decision request**: the emerging options with refs, which the engine answers with `browser.choose {ref}`.
- Surface `isSelectable` custom dropdowns as `select` in the tree.

**Source:**

- `skyvern/skyvern/webeye/scraper/domUtils.js:3291-3442` and `:3619-4141`;
- `skyvern/webeye/actions/handler.py:718`, `:11209`, `:13204`, `:14049`, `:14931`;
- `skyvern/forge/prompts/skyvern/custom-select.j2` (its rules paraphrased into the decision request).
- All AGPL-3.0.

**CDP:** None. The detection and observer are pure JS; clicks are native.

**Impact:** High. Combobox-heavy forms are where Skyvern's harness-side intelligence clearly beats prompting.

### G5. A settle that also waits for the network

**Build:**

- An install-once `WKUserScript` in the **page world**, run at document start, that wraps `fetch` and `XMLHttpRequest` to count requests in flight. It ignores requests older than 1.5 s.
- A `PerformanceObserver('resource')`.
- Navigation-delegate state (`didCommit`, `didFinish`, HTTP status).
- Thresholds: 80 ms DOM quiet measured from the start of the action, an 800 ms action cap, a 3,000 ms state or loading cap.
- Skeleton-screen detection: more than 20 elements with fewer than 5 text characters per element while requests are in flight means "may still be loading".

**Source:**

- `browser-use/browser_use/ax.py:408-450`, MIT.
- `bu-0x/browser_use/agent/prompts.py:150-250` and `browser/watchdogs/dom_watchdog.py:93-290`, MIT.
- `skyvern/skyvern/webeye/utils/page.py:3519-3689` (loading indicators), AGPL-3.0.

**CDP:** Hard in the sources (CDP `Network.*`). The native version above is an approximation. The page-world wrapper is visible to the page; that is a stealth trade-off, so it should be a per-profile switch.

**Impact:** Medium to high. It addresses Misty's "no network idle" gap, which shows up as reads taken before an SPA has finished rendering.

### G6. Loop and stall guards, budget-aware nudges

**Build:** The brain counts patterns in the tool results it serves:

| Guard | Nudge after | Terminate after |
|---|---|---|
| Identical canonicalized reads, no action between (perception stall) | 6 | 15 |
| Same tool and arguments with no evidence of page change (action loop) | 3 | 8 |
| Main-frame fingerprint unchanged (page-state stall; shadow mode first) | 8 | 12 |

- A 404/410 response is a dead end; 401, 403, 429 and 5xx are treated as recoverable.
- The "terminate" level becomes a strong instruction to finish or hand off. The harness does not end the run on its own.
- A nudge is text prepended to the tool result.

**Source:** `skyvern/skyvern/forge/taskv3/loop.py:995-1145`, `:4282-4285`, AGPL-3.0.

**CDP:** None.

**Impact:** Medium. It saves budget on long Odysseys tasks.

### G7. The script tool as the primary path for strong engines

**Build:** Move `browser.run` (QuickJS) into the brain and widen it:

- a persistent context per run, so variables survive between calls;
- 60 s by default, 10 min at most;
- a page-call budget of about 400 instead of 80;
- the API from report 22 §7.2: `page.snapshot/find/act/fill/text/markdown/capture/waitFor`, `tabs.*`, `frames.list`, `checkpoint`, and workspace `read`/`write`/`import`;
- captures auto-attached to the MCP result, at most 4 per call, 2,048 px sides;
- output capped at 12k chars, with overflow going to a file.

No raw `eval` by default (section 4.4).

**Source:**

- `browsercode/packages/bcode-browser/src/browser-execute.ts:53-305` and `packages/codemode/`, MIT.
- `browser-use/browser_use/repl/session.py:42` and `repl/worker.py:61-62`, MIT.

**CDP:** Partial in the sources (raw `cdp()`). The native version replaces it with named primitives.

**Impact:** Medium to high on extraction and pagination tasks. It drives the token savings seen with code as action.

### G8. Session health: verify the user's sign-ins are usable

**Build:**

1. A `signInProbe` op: exactly one visible password field not marked `new-password` means a sign-in form. On a page reached with a profile loaded, report `saved_profile_signed_out {site}` and offer `browser.request_user_action{sign_in}`.
2. Actually set `target.authentication = "required"` from that probe, so the existing dead checks come alive.
3. Ship the saved-session instruction in `INSTRUCTIONS_WITH_BROWSER`: "you are already signed in where the person is; check before attempting to log in; never type credentials".
4. A session-cookie sidecar: on profile close, save session-only cookies from `WKHTTPCookieStore`; restore them before the first navigation. Whether WebKit drops them for Misty's process lifecycle needs checking first (inferred).
5. For benchmarks: fix the stale snapshot copy of the store in the debug app. Either point the eval build at the release store explicitly, or re-link on demand (`profile_store.rs:51-104`).

**Source:**

- `skyvern/skyvern/forge/sdk/workflow/models/code_block_recorder.py:91-112`;
- `skyvern/forge/failure_classifier.py:718-751`;
- `skyvern/webeye/session_cookies.py:1-40`;
- `skyvern/forge/sdk/workflow/service.py:11398-11410`.
- All AGPL-3.0.

**CDP:** None, or partial (the cookie API). Native: `WKHTTPCookieStore`.

**Impact:** Medium overall, and large on tasks that need a signed-in account. It directly answers the user's step 4.

### G9. Per-site learning: notes and a plan cache

Section 5 has the full design.

**Source:**

- `skyvern/skyvern/core/script_generations/generate_script.py:374-945`;
- `skyvern/core/script_generations/skyvern_page.py:438-575`, `:1743`, `:3661`;
- `skyvern/core/script_generations/real_skyvern_page_ai.py:840-900`, `:1079`;
- `skyvern/services/script_reviewer.py:528-1036`;
- `skyvern/schemas/self_heal.py:47-231`.
- All AGPL-3.0.
- `browser-harness/src/browser_harness/helpers.py:152-157` and `browser-use/browser_use/agent/judge.py:53-70` (gotchas), MIT.

**CDP:** None.

**Impact:** Low on cold benchmark runs. High for Misty users who repeat tasks on the same sites.

### G10. Uploads, downloads and dialogs for engines

**Build:**

- Expose upload to engines through a **trusted** path: click the input natively, then answer `WKUIDelegate runOpenPanelWithParameters` (or the GTK `run-file-chooser` signal) with a file staged by `fileId`. Keep the `DataTransfer` path as the fallback.
- Report downloads in the act result, for example `[download started: x.csv]`, `not triggered` or `timeout`. Name files without overwriting (`x (1).csv`).
- Dialog text goes into the next state header.

**Source:**

- `skyvern/skyvern/webeye/actions/handler.py:353-371` and `:11025`, AGPL-3.0.
- `browser-use/browser_use/repl/worker.py:255-274`, `:1212-1213`, and `repl/remote_upload.py:39-97`, MIT.

**CDP:** Hard in the sources. Native WKDownload and WKUIDelegate are simpler and more complete.

**Impact:** Medium. Tasks that attach files fail outright today.

### G11. Perception upgrades

**Build:**

- Per-line `[offscreen]` and `[covered by eN dialog "…"]` marks, from an `elementsFromPoint` sample of the centre plus 4 inset points for candidates inside the viewport.
- 99% containment collapse inside `a`, `button` and `[role=button|combobox]`.
- Scroll hints: "2.3 pages below", and "N more elements below" for scroll containers.
- Format hints for date, tel and datepicker classes; image alt or filename context for icon-only controls.
- Port domUtils' library-specific interactability rules. A tiny page-world helper stamps `data-misty-click` on elements that have jQuery or Angular listeners.

**Source:**

- `bu-0x/browser_use/dom/serializer/serializer.py:772-1406` and `clickable_elements.py`, MIT.
- `skyvern/skyvern/webeye/scraper/domUtils.js:1251-1474`, AGPL-3.0, with its Playwright-derived parts under Apache-2.0.

**CDP:** Hard for paint order in the source. Native: hit-testing, which matches what a click would hit.

**Impact:** Medium. A/B test it against the current format (report 20 §6).

### G12. Plumbing: pinned runtime and trusted input in cross-origin frames

**Build:**

- Install the runtime once per document as a `WKUserScript` in world `misty-agent-page`, in all frames, at document end, with a hash check. `page.op` then sends only the operation and its arguments.
- A native click inside a cross-origin frame, at the top-viewport point: the parent's iframe rect plus the child's own rect.

**Source:** Misty's own code. The idea of an idempotent install is in `skyvern/skyvern/webeye/utils/page.py:475-498`, AGPL-3.0.

**CDP:** None.

**Impact:** Medium on latency. Today about 114 KB is re-parsed on every 250 ms poll. Trusted input in frames unblocks payment and consent iframes.

### G13. A capped `look` with marks

**Build:** A viewport capture with ref boxes drawn **host-side** onto the snapshot, never in the DOM, from rects the runtime returns. Capped at 20 per run, for genuinely visual problems.

**Source:** `skyvern/skyvern/forge/taskv3/tools.py:5608` and `:23919-23980`, AGPL-3.0.

**CDP:** Partial in the source. Native: `takeSnapshot` plus a Rust image overlay.

**Impact:** Low to medium.

---

## 4. Architecture: a brain sidecar over page primitives

### 4.1 Processes

```
 Engine (Claude Code / Codex CLI)
        │ MCP (Misty's existing endpoint, bearer per run)
        ▼
 Misty app (Tauri) ─────────────── trust boundary ───────────────┐
  • MCP endpoint, tool journal, run policy, taint (unchanged)    │
  • forwards browser_* tool calls to the run's brain             │
  • PAGE HOST: webviews, WKWebsiteDataStore per profile,         │
    content worlds, native input, captures, downloads,           │
    dialogs, consequence gate, confirmation island, site blocks  │
        ▲  primitive protocol (JSON-RPC 2.0, Unix socket 0600)   │
        │                                                        │
 harness-brain (sidecar process, one per active run) ◄───────────┘
  • tool semantics: batches, waits, settle, diff state, guards,
    finish packet, script runtime (QuickJS), widgets, frames splice,
    recipes and site notes, evidence writer
  • serves the same tools as stdio MCP in benchmark mode

 Benchmark mode:  Engine ──MCP stdio──► harness-brain ──primitives──► harness-host (wry/tao window)
```

- **Process model.** One brain process runs per active run. Misty spawns it as a Tauri sidecar binary built from this repository.
- **Crash containment.** A brain crash or hang fails only that run's next call. Misty marks the in-flight journal row `uncertain` (`misty/src-tauri/features/agents/run_control/local_tools.rs:351`) and respawns the brain on the next call. Webviews and signed-in stores never leave Misty's process. This mirrors how engines are just CLI processes.
- **Front ends.** The brain has two:
  - `tool.call` from Misty, which keeps Misty's tool-level journal, policy and taint exactly as they are;
  - stdio MCP, for the standalone `harness-host` used by benchmarks and CI.
- **One brain binary.** The same binary and tool descriptions run in both settings, so benchmark numbers describe the product.

### 4.2 What stays in Misty, and what moves

**Stays in Misty** (the trust boundary in report 30 §13):

- webview handles and data stores;
- `WKFrameInfo` registry;
- native input, with pre-dispatch checks on generation, origin, viewport, visibility and grant, run on the main thread;
- captures;
- download and dialog delegates;
- the consequence verdict and the confirmation island;
- site blocks and take-over;
- the per-operation grants.

**Moves to the brain:**

- `batch.rs` sequencing;
- the waits (`poll`, `first_load`, `landed`);
- frame splicing and ref-slot bookkeeping;
- the skill phase loop;
- the `browser.run` sandbox;
- recovery heuristics;
- the diff state;
- guards;
- recipes;
- the evidence writer.

**The page runtime JS** stays in `crates/page-runtime`. Misty compiles in the hashes it accepts (section 4.4).

### 4.3 The primitive protocol (v1)

**Transport.**

- JSON-RPC 2.0 over a Unix domain socket created by the host with mode 0600.
- The path and a 32-byte token are passed to the brain via environment variables.
- Messages are length-prefixed (4-byte big-endian length, then UTF-8 JSON).
- Every request carries `{runId, callId, deadlineMs}`. `callId` is the idempotency key the host journals: a repeated `callId` returns the first result and never re-dispatches.
- Host to brain: notifications only (`event`).

**Handshake.**

```
host.hello {protocol:1, brain:"0.x.y", token, runtime:{sha256}}
 -> {host:"misty"|"wry-host", platform:"macos"|"linux", protocol:1,
     capabilities:["page.input","page.upload","engine.ask","frames.crossOrigin",
                   "net.counter","eval.isolated"?],
     runtimeAccepted:bool, limits:{maxTabs:32, captureMaxDim:2048}}
```

**Tabs.**

| Method | Params | Result |
|---|---|---|
| `tabs.open` | `{url?}` | `{scopeId, url, title}`. The profile and store are chosen by the host from the run's window. The brain never names a profile |
| `tabs.close` | `{scopeId}` | `{}` |
| `tabs.list` | `{}` | `[{scopeId, url, title, asleep}]` |

**Page.**

| Method | Params | Result |
|---|---|---|
| `page.state` | `{scopeId}` | `{url, title, origin, documentId, loadGeneration, loading, http:{status}, viewport:{w,h,dpr,zoom}, visible, dialogs:[{id,type,text}], netInflight}` |
| `page.navigate` | `{scopeId, url, wait:"commit"|"load"}` | `{navigationId, url, http:{status}, error?}`. The host applies its URL policy: private hosts, taint, blocks |
| `page.op` | `{scopeId, frameId?, op, args, documentId?}` | the op's JSON. Errors with `stale_document` if `documentId` mismatches |
| `page.act` | `{scopeId, documentId, target:{ref}|{locator:{role,name,index}}, action, args, allowConsequential, expect:{generation}}` | the typed outcome of G3, plus `consequence:{kind, asked, answer}` |
| `page.input` | `{scopeId, kind:"click"|"move"|"wheel"|"key"|"text", x, y, …, expect:{generation, origin, viewport}}` | `{dispatched, verdict}`. Visual-point input only; the host runs `consequenceAt` first |
| `page.capture` | `{scopeId, rect?, maxDim, format:"jpeg"|"png", quality, marks?:[{ref,rect,label}]}` | `{mime, base64, sha256, w, h}` |
| `page.upload` | `{scopeId, documentId, ref, fileId}` | `{verified, files:[{name,size}]}`. `fileId` is a Misty attachment or download. The brain never sends paths |
| `page.dialog` | `{scopeId, dialogId, accept, text?}` | `{}` |

`page.op` is limited to a whitelist of named operations:

- reads: `snapshot`, `observe` (diff), `find`, `markdown`, `text`, `rect`, `describe`;
- action support: `prepare`, `settle`, `waitCheck`, `mark`, `locate`, `locatorFor`, `skill`;
- popups and gates: `declineConsent`, `dismissPopup`, `consequenceAt`, `consequenceOfKey`;
- widgets and probes: `emergingStart`, `emergingTake`, `signInProbe`, `fingerprint`, `scrollContainer`.

**Frames, downloads and the person.**

| Method | Params | Result |
|---|---|---|
| `frames.list` | `{scopeId}` | `[{frameId, url, origin, parentRef?, rect?}]` |
| `downloads.list` | `{scopeId, since?}` | `[{id, name, mime, bytes, state}]` |
| `person.ask` | `{scopeId, kind, control, reason}` | `allowed`, `refused` or `unanswered` (180 s) |
| `person.handoff` | `{scopeId, action:"sign_in"|"challenge"|…, reason}` | resolves when the person continues |

**`engine.ask`** is Misty only (section 6):

```
engine.ask {purpose:"finish_judge"|"choose"|"review", prompt, images:[sha256],
            schema, maxSeconds}
 -> {answer, engine, model}
```

**Events.**

```
event {scopeId, kind, at, data}
```

`kind` is one of:

- `load.started`, `load.committed`, `load.finished`, `load.failed`, `url.changed`, `title.changed`;
- `dialog.opened`, `dialog.closed`, `popup.opened`;
- `download.started`, `download.finished`, `download.failed`;
- `frame.announced`;
- `takeover.started`, `takeover.ended`;
- `tab.slept`, `tab.woke`;
- `process.terminated`.

**Errors.** Each error is JSON-RPC `error.data.code` plus a human `followup`. The codes are:

- `stale_ref`, `stale_document`;
- `target_covered` (with `by:{ref, role, name}`), `target_hidden`, `target_disabled`;
- `consequential_requires_approval`, `refused_by_person`, `blocked_site`;
- `taken_over`, `grant_revoked`;
- `frame_gone`, `timeout`, `unsupported`.

### 4.4 Security rules of the protocol

1. **The gate is the host's.**
   - `page.act` is coarse on purpose: resolve the ref, compute the point, classify, ask, check the generation and send the native event, all in one host call.
   - The brain cannot claim `consequence: none`. The host computes it.
   - `allowConsequential` only lifts the second tier.
2. **No raw script into signed-in pages by default.** `eval.isolated` is an optional capability.
   - Misty does not advertise it.
   - `harness-host` advertises it only when started with an explicit flag.
   - Scored benchmark runs keep it off, so they measure the product. An "eval on" column may be reported separately.
3. **Pinned runtime.** The brain sends the runtime's `sha256` in `host.hello`. Misty accepts only hashes compiled into its build (it links the same `page-runtime` crate). It then installs that runtime as a `WKUserScript` in `misty-agent-page`, in all frames, at document end. Re-sending the runtime with each call goes away (G12).
4. **Profiles and paths are host-chosen.** The brain never names a profile, store or file path. Secret fields stay unreachable, as they are today (`page_core.js:170-179`).
5. **Redaction.** The brain redacts cookie-like and token-like strings from tool output, porting `browser-use/browser_use/repl/session.py:140-206` (MIT).

### 4.5 The standalone wry host

`crates/host` grows from a single-shot snapshot binary into a long-running host:

- a tao event loop with one wry `WebView` per tab;
- a persistent `WKWebsiteDataStore(forIdentifier:)` named by `--profile <id>`;
- the same content-world, frame-announcement, native-input, capture, download and dialog code, extracted from `misty/src-tauri/features/browser/` into a shared crate `crates/native` behind a `PageHost` trait;
- `consequenceAt` and the gate in an auto-refuse mode for unattended runs, or `--allow-consequential` for benchmark sandboxes.

The brain talks to it over the same socket protocol. The benchmark then runs **without the debug app**:

```
misty_eval.py → claude -p (Opus 5.5) → MCP stdio → harness-brain → harness-host
```

To keep sign-ins equivalent, the host can open the **release** profile store identifier read-write while the app is closed. Whether two processes can share a store concurrently is unsupported (inferred), so the host refuses to start while Misty holds that store.

---

## 5. Self-healing: notes and a per-site plan cache

The user chose to keep learned per-site plans. Two tiers, both stored **per Misty profile**, because the sessions they rely on are per profile:

```
~/.misty/data/browser-learning/<profile>/<site>/{notes.md, recipes.json, episodes.jsonl}
```

### 5.1 Site notes (cheap, always on)

- **What they are.** Short, general lessons about a site. They never mention the agent's tooling, never contain PII and never contain task values. Examples: "Workday date fields reject typing; use the picker"; "search results lazy-load after 2 scrolls".
- **Who writes them:**
  - the engine, through a `browser.site_note {site, note}` tool;
  - the finish packet, which asks for one gotcha whenever the site rejected input, errored or blocked (browser-use's rule, `agent/judge.py:53-70`).
- **When they are shown.** On the first `navigate` to a registrable domain in a run, the result lists up to 5 notes (browser-harness `domain_skills`, `helpers.py:152-157`).
- **Ageing.** A note older than 90 days without a confirming run is dropped.

### 5.2 Recipes (the plan cache)

**Key.** `(site, entryRoute, intent)`:

- `site`: the registrable domain (eTLD+1), or a **platform id** when a detector matches. Workday, Greenhouse and Shopify checkouts share recipes across employers and stores, as in Skyvern's ATS keying (`workflow_script_service.py:410`).
- `entryRoute`: the URL path template, with ids and long tokens replaced by `*` and the query dropped.
- `intent`: a normalized slug that the engine provides when saving, for example `add-to-cart`, `export-orders-csv` or `book-appointment`. Tasks are free-form chat, so the intent cannot be inferred reliably; the engine names it.

A recipe is saved only after a run whose finish packet showed the goal achieved.

**Schema:**

```json
{
  "key": {"site":"example.com","entryRoute":"/orders","intent":"export-orders-csv"},
  "version": 3, "params": ["dateFrom","dateTo"],
  "steps": [
    {"pre": {"url": "^/orders(\\?|$)", "text": ["Orders"]},
     "act": "click",
     "target": {"locator":{"role":"button","name":"Export","index":0},
                "alts":[{"css":"[aria-label='Export']"},{"hasText":"Export","tags":["button","a","[role=button]"]}]},
     "intent": "open export dialog", "desiredState": null},
    {"act":"fill","target":{"locator":{"role":"textbox","name":"From"}},"value":"{{dateFrom}}"}
  ],
  "stats": {"runs":[{"at":"…","outcome":"replayed|healed|floor|failed"}]}
}
```

**Parameterization.**

- Typed values are replaced with `{{param}}`. Like Skyvern, only values of 4 to 500 characters are parameterized (`generate_script.py:~421-428`).
- Secret, OTP and card fields cannot be recorded at all, since the agent can never fill them.
- A step classified as consequential is recorded with `"gate":true`. On replay it goes through `page.act` and the host gate like any other step. **A recipe never pre-approves anything.**

**Replay.**

- `browser.recipe_run {intent, params}`, or a hint in the first `navigate` result: "a saved recipe exists for export-orders-csv".
- The brain runs each step:
  1. **Precondition** check, as a three-tier classify (`real_skyvern_page_ai.py:840-900`): URL regex, then a substring match on page text, then otherwise a **divergence**.
  2. **Target resolution:** the locator, then the alternatives in order (first match wins), then otherwise a divergence.
  3. The act itself, with the same typed outcome and effect verdict as live actions. A failure or `no change` is a divergence.
- **On divergence**, the brain stops, records an episode and returns control to the engine:
  - the failed step and its intent;
  - the element signature it expected;
  - the current compact state;
  - "continue the task from here; the recipe diverged at step k".

  This is Skyvern's `element_fallback` from the current page (`skyvern_page.py:3661`), with the engine as the fallback agent. A whole-recipe failure falls back to an ordinary live run.
- **Episode contents:**
  - the failed selector or locator;
  - the intent;
  - what the engine did instead, captured from its next successful `page.act` targets;
  - the tag, text and whitelisted attributes of the element that worked.

**Healing.** This is additive only, like Skyvern's reviewer (`script_reviewer.py:528-536`). After a run with episodes, the brain:

- merges the working element as a new `alt` at the front of that step's alternatives;
- inserts steps the engine took before succeeding, for example dismissing a popup, as **optional** steps whose precondition is that the popup's text is present.

It never deletes a step automatically. Ambiguous merges, such as a reordered flow, are written as a new branch keyed by the precondition that told them apart. Old versions are kept for rollback. If a review needs judgement, the brain may use `engine.ask {purpose:"review"}` through Misty; otherwise healing is purely mechanical.

**Invalidation and demotion.** The reliability window is 20 runs, scored once at least 10 exist. The thresholds are Skyvern's (`skyvern/schemas/self_heal.py:47-48, 231`):

| Status | Condition | Effect |
|---|---|---|
| `healthy` | otherwise | auto-offered |
| `watch` | 2 or more healed runs, or 2 healed in a row | still offered, flagged |
| `action_needed` | 3 or more healed runs in the last 10, or heal rate of 0.2 or more, or 2 or more "floor" runs (full fallback) | **demoted to a note**: its steps are shown as advice, not run |

- Branches not hit for 90 days are pruned.
- A failure triaged as not fixable in code does not count against the recipe. That covers site down, challenge, signed out, rate limited and missing data (Skyvern's `script-failure-triage.j2` categories). It is classified heuristically with the G3 failure categories, and `saved_profile_signed_out` routes to `person.handoff`.

**Benchmark policy.** Scored runs use an **empty learning store**: notes and recipes are off, or isolated per run. Otherwise, learning from earlier tasks in the same set would contaminate the scores. A separate "warm" column may be reported only from a store built on a disjoint task set.

---

## 6. Engines as the model

The harness never calls an LLM API. The engine, Claude Code with Opus 5.5 for benchmarks, drives it over MCP.

Every mechanism in the sources that assumes the harness owns a model call is restructured in one of four ways:

- **E**: moved into the engine's skill or tool text;
- **D**: made deterministic in the harness;
- **R**: returned to the engine as a decision request in the tool result;
- **A**: `engine.ask` through Misty, which runs a one-shot engine turn on the person's subscription. It is used only where the engine's own context would bias the answer. No API key is involved.

| Source mechanism | Assumes own LLM call | Misty treatment |
|---|---|---|
| Skyvern v1 `extract-action.j2` planner and action schema (`agent.py:9358`) | yes | **E**: per-action "when / when not" rules go into tool descriptions (WAIT last, GOTO never invents URLs, KEYPRESS only without a button, CAPTCHA just before submit) |
| v2 planner `task_v2.j2` (subgoals, loops, wrap-up) | yes | **E**: skill text: keep a `required_subgoals` checklist with evidence; navigate never extracts; loop over lists; at 80% of budget work only unsatisfied subgoals; re-plan more specifically after a stall |
| `complete_verify` / `check-user-goal.j2` and the v3 goal judge | yes | **D + R** by default: `browser.finish_check` builds the evidence-only packet, and the engine must judge it before finishing. **A** (`purpose:"finish_judge"`, same engine and model, a fresh context holding only the packet and the judge rules) is behind a flag, for A/B testing whether isolation helps Opus |
| Parallel verification and speculative next-step plan (`agent.py:11689`, `:7683`) | yes | Dropped. The engine's loop is not ours. Settle-then-observe in the act result already removes the "look" turn |
| Custom-select, autocomplete-choose and potential-answers mini-agents | yes | **D** first (option matching, `classify_option_match`), then **R** (emerging options returned with refs; the engine calls `browser.choose`) |
| `svg-convert.j2` and CSS-shape naming (`agent_functions.py:680-1049`) | yes | **D**: aria-label, title and `<title>`, image alt or filename context, and a small static icon dictionary. Revisit later |
| `extract-information.j2` with schema (`handler.py:16980`) and the extraction cache | yes | **E**: the engine reads `markdown`/`text` ops or extracts in `browser.run` and writes files; Misty already withholds `browser.extract` (`mcp.rs:50-52`) |
| `summarize-max-steps/retries` and LLM failure categories | yes | **D**: heuristic failure categories; the engine writes its own summary |
| `handle-dialog.j2` (accept or dismiss) | yes | **D**: auto-accept alerts; confirm and prompt dialogs are surfaced in the state header and answered with `page.dialog` by the engine (**R**) |
| `check-date-format.j2` | yes | **D**: ISO for native inputs; datepicker format hints in the state |
| `page-classify` (tier 3 of classify) | yes | Tiers 1 and 2 are **D**; tier 3 becomes a divergence handed to the engine |
| `script-reviewer.j2` / `script-failure-triage.j2` | yes | **D** (additive merge, heuristic triage), with **A** (`purpose:"review"`) only for ambiguous branches |
| browser-use post-run judge with gotchas (`agent/judge.py`) | yes (own model) | Gotchas are requested in the finish packet (**R**) and stored as notes. It is **not** a benchmark scorer |
| browser-use compaction (`loop.py:754-816`) | yes | Not needed: the engine compacts its own transcript. Keep tool results compact and stable-prefixed instead |

**Benchmark judging follows each benchmark's rules exactly.**

- **BU Bench.** `harness/benchmarks/bu-bench/misty_eval.py` already calls the benchmark's own `judge_trace` with its default judge (`gpt-5.6-luna`, xhigh; `README.md` setup step 1).
  - That judge needs the benchmark's OpenAI access. Routing it through Misty's Codex subscription would satisfy the user's "no new API key" goal only if the request is identical: the same model, reasoning effort, prompt, schema and images.
  - That needs a transport shim, which must be audited before any score is reported. Until then, report which transport was used.
- **Odysseys.** Use the upstream judge from `ljang0/Odysseys`, vendored byte-identical, as Skyvern does (`skyvern/pyproject.toml:318` excludes `_odysseys_upstream_full_traj.py` from lint for that reason; the file itself is not in OSS).
  - Use the upstream judge model and rubric protocol.
  - The dataset is MIT (`skyvern/evaluation/datasets/ODYSSEYS_ATTRIBUTION.md`).
  - Confirm the upstream judge's model before running; it is not in our checkouts.
- **Never use Skyvern's WebVoyager judge.** It looks only at the final screenshot (`skyvern/evaluation/core/__init__.py`). Do not adopt its date-rewriting without a separate column.

---

## 7. Phased implementation order

### Phase 0: baseline (prerequisite, about 2 days)

1. **Freeze subsets with fixed task ids:**
   - BU Bench V2.1: 50 tasks, stratified;
   - Odysseys: 30 tasks, roughly 7 easy, 7 medium and 16 hard, matching the 45/46/109 split.
2. **Fix the benchmark evidence gap.** In eval mode, capture after every browser tool event, never drop a capture (re-encode it smaller instead), and record per-step capture coverage.
3. **Verify sign-ins** in the store the eval build actually uses (`profile_store.rs:51-104`), and record which profile is used.
4. **Run today's harness** on both subsets: Opus 5.5, Claude Code, the benchmark judges. This is the baseline.

### Phase 1: act, observe, settle (small enough to land and benchmark in one cycle)

All of this phase goes into the existing in-process path (`crates/page-runtime` plus `misty/src-tauri/features/browser/agent_pages/`), so it does not wait on the sidecar:

1. **Pinned runtime (G12, first half).** Install it once per document as a `WKUserScript` in `misty-agent-page`, in all frames. `call_at` sends only `page.call(op, args)`, with a fallback that re-installs if `__mistyAgentPageV1` is missing.
2. **Effect verdicts and diff state (G1).**
   - Add `PROBE_JS`-style `doc` and mutation counters to `page_read.js`.
   - Give each step outcome `effect` plus a verdict line.
   - Add an `observe` op that returns the compact state with `*` new refs, about 4,000 chars, 80/20 cut.
   - `after_snapshot` uses it unless the step navigated.
3. **Settle v2 (G5, minimal).**
   - A page-world `fetch`/XHR in-flight counter behind a profile switch, on for benchmark profiles.
   - `PerformanceObserver`.
   - Switch the thresholds from 150/1500 ms to 80 ms quiet from the start of the action, 800 ms cap, and 3,000 ms while `readyState=='loading'`.
4. **Sign-in health (G8, minimal).**
   - `signInProbe` sets `target.authentication`.
   - Add the saved-session sentence to `INSTRUCTIONS_WITH_BROWSER`.
5. **Skill and tool text (E rows in section 6).**
   - Subgoal checklist, verify after every mutation, batch reads with actions, do not finish without re-observing settled content.
   - Under 60 lines, kept only if the subset score does not drop. BrowserCode removed a skill that hurt (`browsercode/packages/opencode/src/skill/index.ts:277-282`).

**Exit criteria:**

- Same subsets and judges as Phase 0.
- Report the mean score, median input tokens, turns per task and capture coverage.
- Keep each change only if the score is not worse, with confidence intervals, and tokens fall.

### Phase 2: brain sidecar and standalone host

- Build the primitive protocol v1.
- Extract `crates/native` behind a `PageHost` trait.
- Make `harness-host` long-running.
- Build `harness-brain` with both front ends.
- Move batches, waits, frames splice and `browser.run` into the brain.
- Add the G6 guards, the G2 finish packet, checkpoint and deliver-now.
- Benchmarks move to `harness-host`.
- **Gate:** parity with the Phase 1 score on the subsets.

### Phase 3: action reliability

- G3 ladders and typed failures.
- G4 composite widgets with emerging elements.
- G10 trusted upload, downloads and dialogs.
- G12 trusted input in cross-origin frames.

### Phase 4: perception and the script path

- G11 occlusion, viewport and scroll hints, containment, format hints, and the ported interactability rules.
- A/B test the YAML format against flat AX lines.
- G7 widened `browser.run` as the main path for Opus.
- G13 `look` with marks.

### Phase 5: self-healing

- G9 notes, recipes, episodes, additive healing, reliability states and failure triage.
- Measured on repeat-task suites, never on cold scored runs.

### Phase 6: breadth

- Full BU Bench V2.1 and all 200 Odysseys tasks.
- Then WebVoyager (from upstream), Online-Mind2Web and others, each with its own judge.
- The WebKitGTK host.

**About the "80 mean" target.** On BU Bench V1, top models score 87-89 with Browser Harness (`browser-harness/README.md:57`, image alt text). V2.1 is far harder: about 60 for GPT-6 Luna medium. Treat 80 as an Odysseys and V1-class target. On V2.1, measure Misty against the BrowserCode, Playwright MCP and Chrome DevTools MCP rows with the same model, and use the confidence intervals to decide when the harness has stopped being the bottleneck.

---

## 8. Licensing and attribution

**Misty and this repository.** AGPL-3.0-or-later, plus the NOTICE §7(b) author-attribution term (`harness/NOTICE`). Under AGPL section 7, that additional term covers Misty's own material. Derived third-party files keep their own notices.

### 8.1 Skyvern (AGPL-3.0)

- **Root license.** The root `LICENSE` is AGPL-3.0. There are no per-directory licenses, and the anti-bot code is absent from the repo, not differently licensed (`README.md:589-590`).
- **Copyright holder.** The repo has no explicit copyright line. Name "Skyvern AI" (`pyproject.toml:5`) and the repo URL.
- **Areas we derive from:**
  - `skyvern/webeye/scraper/domUtils.js`
  - `skyvern/webeye/actions/handler.py`, `webeye/utils/{dom,page}.py`
  - `skyvern/forge/taskv3/{loop,goal_check,tools,engine}.py`
  - `skyvern/forge/prompts/skyvern/*.j2` (paraphrased)
  - `skyvern/core/script_generations/*`, `skyvern/services/script_reviewer.py`
  - `skyvern/schemas/self_heal.py`, `skyvern/forge/failure_classifier.py`
  - `skyvern/webeye/session_cookies.py`, `forge/sdk/workflow/models/code_block_recorder.py`
- **Exclusions:**
  - Do not derive from `skyvern/forge/sdk/api/llm/ui_tars_llm_caller.py` or `prompts/skyvern/ui-tars-system-prompt.j2`, which are Apache-2.0 UI-TARS code.
  - The functions in `domUtils.js:363-708` are marked "from playwright", which is **Apache-2.0**. Keep those comments and add Playwright's notice.
  - `domUtils.js:29-254` resembles Vimium (MIT, inferred). Add a Vimium notice if it is ported; it is mostly dead code.
- **Required notices:**
  - Each derived file keeps a header naming Skyvern, the source path and commit `cc5ef72b`, "Skyvern AI", AGPL-3.0, and a dated "modified by Misty" statement (AGPL §5(a)).
  - Add a "Third-party code" entry in `NOTICE`.
  - Network users of any hosted Misty get a source offer (AGPL §13).
  - Do not port Skyvern's telemetry.

### 8.2 browser-use (MIT)

- **Copyright.** "Copyright (c) 2024 Gregor Zunic" (`browser-use/LICENSE`, both 1.0.5 and 0.13.14).
- **Areas we derive from:**
  - `browser_use/ax.py`
  - `browser_use/agent/{loop,prompt,judge}.py`
  - `browser_use/repl/{worker,session,remote_upload}.py`
  - 0.x `browser_use/dom/**`, `browser/watchdogs/dom_watchdog.py`, `agent/prompts.py`
- **Caveats:**
  - `ax.py` is a port of "Browser Use Pi ax.ts".
  - `SUMMARY_*`, `CHECKPOINT` and `DELIVERY_REPAIR` are labelled as copied from "Pi" and "bu-pi", whose licenses were not in the checkout. **Paraphrase; do not copy those strings.**
- **Required notice.** The MIT copyright and permission text, in `NOTICE` and in derived file headers.

### 8.3 browser-harness and BrowserCode (MIT)

- **browser-harness.** "Copyright (c) 2026 Browser Use". Derive from `src/browser_harness/{helpers,recorder,daemon}.py` and the key table in `helpers.py:249-324`. Do not port `telemetry.py`.
- **BrowserCode.**
  - "Copyright (c) 2025 opencode". Derive from `packages/bcode-browser/src/browser-execute.ts` and `packages/codemode/` (MIT).
  - Do not derive from `packages/bcode-laminar/`, which is Apache-2.0 telemetry.
  - Do not port the Laminar key or its telemetry.

### 8.4 Datasets

- **Odysseys:** MIT, "Copyright (c) 2026 ljang0". Reproduce the notice with any vendored copy, as `skyvern/evaluation/datasets/ODYSSEYS_ATTRIBUTION.md` does.
- **WebVoyager:** take it from upstream; its license is not stated in Skyvern.
- **BU Bench:** no license is stated. Keep decrypted tasks and rubrics out of version control, as the existing `NOTICE` already says.

### 8.5 Practice

- Add a `THIRD_PARTY.md` table mapping every derived Misty file to its source path, commit, license and notice.
- Add a CI check that fails when a file carrying a `Derived from:` header is missing from that table.

---

## Critic's notes

I checked the synthesis and the seven reports against the checkouts in `refs/`. Nothing was run. The items are ordered by how much they threaten the plan. "(inferred)" marks platform behaviour I know but did not read in these checkouts.

### C1. Engines can bypass the harness, and the plan does not prevent it

- The BU Bench runner only *asks* the engine not to use its own web fetch or search. Its README says "That last part is only an instruction; check `events.jsonl` if a score looks too good" (`harness/benchmarks/bu-bench/README.md`, "How it differs"). Claude Code also has Bash, so `curl` and `python -c urllib` are available.
- The published comparison ran with "web search off" (`browser-harness/README.md:73`).
- browser-use 1.0 gives its own agent `http_get`, which fetches from the machine without browser cookies (`browser-use/browser_use/agent/prompt.py:16`, `repl/worker.py:428-431`). That is a second reason scores from different setups are not like-for-like.
- **Fix, in Phase 0:**
  - Start scored runs with WebFetch and WebSearch disallowed, and Bash network access denied by the sandbox.
  - Scan each task's events. Mark the task `contaminated` if any non-browser network tool ran.
  - Report contaminated tasks separately.

### C2. Setup differences make the comparison with the Browser Use table invalid

The table in `browser-harness/README.md:71-76` was measured under conditions Misty does not reproduce:

- every tool drove "the same fresh Browser Use cloud browser over CDP", per task;
- runner, browser and judge failures were rerun once.

Misty's runs differ:

- They share one profile's cookies and site state across tasks (bu-bench README, "Fresh browser per task").
- They browse signed in as a real person, so search, YouTube and Amazon results are personalised. Benchmark actions also leave history in those real accounts.
- They use the local IP and region.

**Fix:**

- Scored runs use a fresh data store per task: a non-persistent `WKWebsiteDataStore`, or a new identifier per task.
- Signed-in runs are a separate, labelled column. They test the user's step 4, not the harness.
- Write down a rerun rule for infrastructure failures in advance, and record the region.

Phase 0 step 3 ("verify sign-ins in the store the eval build uses") currently pushes scored runs toward the wrong setup.

### C3. Odysseys scores what is left open in tabs, and Misty puts tabs to sleep

I counted from `skyvern/evaluation/datasets/odysseys_tasks.json` (200 tasks):

- **Tabs are central.** 192 of 200 tasks mention tabs. 502 of 1,225 rubric checkpoints refer to what is open or visible. An example from task 1, R1: "A grader can see the Hulu title page … open in a browser tab".
- **Most tasks start at Google.** 130 of 200 start at `https://www.google.com`.

Two parts of Misty's current behaviour work against this:

- **Tabs sleep.** "Only the page an agent is acting on stays rendered; a tab it moved on from sleeps" (`misty/src/features/agents/tabs/agentTabs.ts`, header comment). Waking a tab reloads it, which loses SPA state and results.
- **Tabs are deduplicated.** "A repeated URL returns the existing tab" (report 30, line 79).

The synthesis does not mention either. **Fix:**

- In benchmark mode, turn tab sleep off, or keep at least 8 tabs live.
- Write a final tab inventory to the trace: url, title, and a fresh capture of each tab.
- Do not deduplicate a URL when the task asks for separate tabs.

Two more points:

- Get the upstream Odysseys judge's input format before building the evidence writer. It is still unknown (§6).
- Measure how often Google shows a challenge in Phase 0. With nobody present, a challenge handed to the person is a task failure. Report it as an environment failure.

### C4. Judging and quota conflict with "no new API key"

- **The BU Bench judge cannot be routed exactly.** A judge request sent through the Codex CLI cannot be byte-identical to the benchmark's request, because the CLI adds its own system prompt, tools and session handling (inferred).
  - The user's two rules therefore conflict: "use the benchmark's judge" and "no new API key".
  - Ask the user to choose: an OpenAI key used only for the judge, or scores labelled "unofficial judge transport".
  - The same question applies to Odysseys until its judge model is known.
- **Subscription quota.** Median input tokens per task were 2.1M to 6.7M (`browser-harness/README.md:79-84`).
  - One pass over the planned 80 tasks is therefore about 170M to 540M input tokens on an Opus subscription. That is likely to hit rate or weekly limits (inferred).
  - Plan for sharding, resuming, and recording which tasks hit a limit. Never record those as model failures.

### C5. Missed source: Skyvern's own MCP server and Claude Code skill

`skyvern/cli/mcp_tools/` is 21,825 lines; `browser.py` alone is 5,351. It is Skyvern's answer to exactly Misty's setting: a coding agent that drives the browser over MCP. **No report covers it.** What is in it:

- **Tool guidance and refs:**
  - A classification table for choosing a tool, and decision rules (`instructions.py:1-80`).
  - `skyvern_observe` plus `skyvern_execute`. Refs persist "until the next observe, navigation, or page/document change" (`browser.py:4245-4275`).
  - The ref key includes the URL, so even a same-document SPA navigation drops the refs (`browser.py:4025-4030`). That is stricter than Misty's `WeakMap` refs.
- **Size limits:**
  - Observe returns 50 elements by default and at most 200, with a per-host budget of 50, 100 or the maximum, learned from the densest page seen on that host (`browser.py:3942-3970`).
  - A shared response distiller caps depth at 4, keys at 24, list examples at 5 and string previews at 240 chars (`response_distillation.py:19-23`).
- **Reads during page changes.** A read that fails because the page changed is retried with backoff from 0.1 s to 1.0 s, under one deadline (`_read_retry.py:30-73`).
- **Fewer turns.** Compound tools such as `navigate_extract_and_screenshot` and `wait_for_either_state` save turns (`browser.py:2570-3154`).
- **Passwords.** Typing a password is refused (`TYPE_PASSWORD_REFUSAL_MESSAGE`, `browser.py:1379`).
- **The skill.** A Claude Code skill (`skills/skyvern/SKILL.md` plus `references/`, 939 lines) includes `complex-inputs.md` and `common-failures.md`.

**License and CDP.** AGPL-3.0; only the root `LICENSE` exists. Input dispatch goes through Playwright (hard CDP dependency), but the tool contracts and text depend on none. Use this as the main reference for G1, G7 and the skill text in §6.

### C6. Missed source: Skyvern's browser-extension mode, which drives the user's real signed-in browser

`skyvern/browser_extension/` (10,485 lines of Python plus `extension/*.js`) controls the user's own Chrome through `chrome.debugger`. That is a hard CDP dependency. **Its policy is what the user's step 4 needs, and it ports directly:**

- **No script evaluation.** Direct JS evaluation is disabled in this mode (`extension/README.md`, the paragraph on `OP_NOT_ALLOWED`).
- **Restricted reach:**
  - Cookie-reading and cookie-clearing methods are denied (`protocol.py:148-157`).
  - Restricted URL prefixes are refused (`protocol.py:159-167`).
  - Only a fixed list of operations is allowed (`protocol.py:79-91`).
- **Page changes cancel operations.** An operation is cancelled if the page changes before or during it (`protocol.py:15-36`). This maps onto Misty's generation and `documentId` checks.
- **The person sees and controls scope:**
  - Tabs are scoped by a "Skyvern Controlled" tab group, with leases.
  - Popups are adopted into the opener's group.
  - A visible "Skyvern is controlling this tab" frame is shown.
  - The machine is paired with a single approval (`extension/README.md`).

This independently supports §4.4 rule 2 ("no raw script into signed-in pages by default").

### C7. G4 is built on Skyvern's older widget code; v3 has the current version

`skyvern/forge/taskv3/tools.py` is 25,965 lines, and the reports cite it in only three places. It contains the newest combobox and commit logic:

- **`select_combobox`:** type, list the options, pick one, then verify the commit (`_ARM_ROWS_AT_PRESS_JS` :4414, `_VERIFY_COMMIT_JS` :4522, `_WATCH_REWRITTEN_ROWS_JS` :5181, `_SUGG_LIST_STILL_OPEN_JS` :5282).
- **Observe hints:** `[autocomplete→use select_combobox]` (:15417).
- **Auto-routing:** typing into what is really a single-select is routed to the open, list and pick path (:20844-20856).
- **Inert-target diagnosis:** after click, hover, type and select_combobox (:610, :751-810).
- **Refusals that say what to do next:** a `next_step` field (:21638).

All of this is in-page JS, so CDP dependency is none for the logic. Port G4 from v3, or at least compare it with v1 `domUtils.js:3291-4141` before choosing. (AGPL-3.0.)

### C8. G1's CDP dependency is understated

browser-use 1.0's compact state is **Chrome's accessibility tree**:

- the state comes from `Accessibility.getFullAXTree` per frame (`ax.py:463-485`);
- the name of the element on top comes from `DOM.getNodeForLocation` plus `Accessibility.getPartialAXTree` (`ax.py:723-733`);
- the probe runs through `Runtime.evaluate` with `userGesture:true` (`ax.py:392-398`).

Only `PROBE_JS` and `VISIBLE_JS` are pure JS. So "CDP: None for this part" is true of the verdict, not of the state. Misty's state would come from the simplified accname in `page_tree.js`; A/B test it before claiming parity.

Two refinements to the verdict:

- **Frames.** `PROBE_JS` cannot see cross-origin frames (`ax.py:105-108`). Misty can add up per-frame counters through `WKFrameInfo`, which is an improvement.
- **Focus.** A click that only moves focus produces no mutation, so it reads as `no change`. Count a change of `activeElement` as a change.

### C9. The v3 goal check is narrower and more lenient than the synthesis says

- **What it is.** It is a *contradiction* test. Silence counts as success: "achieved" includes evidence that is "silent, incomplete, or unable to see the goal's effect" (`prompts/skyvern/taskv3-goal-check.j2`, rule 3 and the verdict list).
- **When it runs.** Only for a single-action block that hit its step cap (`goal_check.py:1-4`, `engine.py:545`). It is skipped for download, extraction and page-free blocks (`goal_check.py:145-148`).
- **When it fails open.** It returns "achieved" after the 20 s timeout, when a secret was typed, and when the instructions exceed 4,000 chars (`engine.py:552-562`).

As a finish gate for Misty, it will rarely block a false completion. Two better options:

- Skyvern v1's `complete_verify` (`check-user-goal.j2`) is the closer task-level equivalent.
- Alternatively, `finish_check` can return a per-subgoal evidence request: quote or capture for each required item. That matches Odysseys rubrics better.

### C10. Native-webview equivalents that would not work as written

**a. JS dialogs are broken in the baseline today.**

- wry's `WryWebViewUIDelegate` implements only the open panel, media capture and `createWebView` (`misty/src-tauri/vendor/wry/src/wkwebview/class/wry_web_view_ui_delegate.rs:97,124,140`). A grep of Misty finds no `runJavaScriptAlert/Confirm/TextInputPanel`.
- Without those methods, WebKit returns `false` from `confirm()`, `null` from `prompt()`, and dismisses alerts (inferred). So "Are you sure?" flows cancel silently.
- **Fix in Phase 1, not Phase 3.** Add the methods to the vendored delegate. Misty already swaps UI delegates in `features/browser/menus/popups/close.rs:112-142`. Route confirm-accept through the consequence gate.
- On WebKitGTK, the default `script-dialog` handler shows a modal dialog (inferred), which blocks unattended runs.

**b. Upload.** G10's `runOpenPanel` hook belongs to wry (line 97 above), which presents an `NSOpenPanel`. Misty must replace it for agent webviews while keeping popup creation, media capture and close behaviour.

**c. Hidden and occluded windows.**

- WebKit throttles `requestAnimationFrame`, timers and painting in hidden or occluded views (inferred).
- That breaks G4's double-rAF settle and can blank `takeSnapshot` captures, which matters for `--parallel` runs and the standalone host on CI.
- Native input already refuses windows that are not visible (`features/browser/input/macos/native_action.rs:79-84`).
- **Fix:** benchmark windows must be visible and not overlapping, or occlusion detection must be turned off through the private `_windowOcclusionDetectionEnabled` (inferred). Linux CI needs a real display.

**d. The standalone host cannot open the release stores.**

- WebKit keeps stores per bundle id, at `~/Library/WebKit/<bundle id>/WebsiteDataStore/<uuid>` (`features/browser/site_data/profile_store.rs:62-75`).
- A `harness-host` with its own bundle id sees an empty set of stores.
- §4.5 therefore needs either the host bundled under Misty's bundle id, possibly with the same signing team (inferred), or a copied store. A copy brings back the stale-copy problem of the debug app.

**e. Counting network requests (G5).**

- `PerformanceObserver('resource')` reports only *finished* resources, so it cannot count requests in flight.
- A page-world `fetch`/XHR wrapper misses workers, service workers, beacons, and image and script loads.
- **Linux:** WebKitGTK 4.1's `resource-load-started` signal, with each resource's finished and failed signals, gives a real native in-flight count (inferred).
- **macOS:** consider the private `_WKResourceLoadDelegate`. Misty already enables `macos-private-api` (`misty/src-tauri/Cargo.toml:60`) (inferred).

**f. Clicks in cross-origin frames (G12).**

- The offset must include the iframe's `clientLeft`/`clientTop` and padding. A simple sum fails under CSS transforms.
- The pre-dispatch hit test must run in the child frame's world at the child-local point. The top frame only sees the `<iframe>`.

**g. Inline PDFs have no DOM.**

- WKWebView draws PDFs natively, so snapshot, markdown and text all come back empty (inferred). No report or gap covers PDFs, and Misty's browser code has no PDF reading path (grep).
- **Fix:** detect an `application/pdf` main resource, fetch the bytes with the store's cookies, and extract the text host-side.
- **Sources:**
  - Skyvern's blocked-inline-PDF recovery: `taskv3/tools.py:25770-25798`.
  - browser-use 0.x print-button handling: `bu-0x/.../default_action_watchdog.py:225-338`.

### C11. Missed source: browser-use 0.x action layer

`bu-0x/src/browser_use/browser/watchdogs/default_action_watchdog.py` (3,758 lines, MIT) is cited only in passing:

- **Direct value assignment** for `date`, `time`, `datetime-local`, `month`, `week`, `color` and `range` inputs, and for datepicker classes and data attributes (`:1620-1670`). This is better than G3's per-character mode for those fields.
- **Framework event sequence:** `input`, then `change`, then `blur`, after a fill (`:2093-2130`).
- **ARIA combobox options** (`:3094`).
- **Scrolling inside a scroll container** (`:2260`).
- **Click with download detection** (`:45`).

One limit on the evidence: the 0.x checkout has no `agent/service.py`. Claims about the 0.x agent loop (planner, memory, loop detection) cannot be checked here.

### C12. Limits of the sign-in probe and the cookie sidecar (G8)

**The probe.** Skyvern's own comment says it is main-frame only and misses email-first sign-in pages, where the password field comes on the next page (`forge/sdk/workflow/models/code_block_recorder.py:90-92`). Google, Microsoft, Apple and Amazon all use email-first sign-in. Add three signals:

- known sign-in hosts;
- a lone `autocomplete=username` or email field;
- redirects to sign-in paths.

**The sidecar.** Skyvern's version writes cookie values as plaintext JSON (`webeye/session_cookies.py:18-40`). It exists because Chromium drops session-only cookies from copied profiles. In Misty:

- store the cookies encrypted, or at least with mode 0600;
- make restoring them opt-in. Re-injecting them extends sessions the site meant to end.

### C13. A claim with no source

§7 says top models score 87-89 on BU Bench V1, citing `browser-harness/README.md:57`. That line is about `src/browser_harness/`. The V1 image is at `browsercode/README.md:57`, and its numbers exist only inside a PNG that no report read. Drop the figure or check it.

### C14. Smaller accuracy fixes

- **G4 matching.** The last step is overlap divided by the larger word count, not Jaccard (`handler.py:754`).
- **The click ladder.** It says "up to 8 strategies" but lists 7.
- **Capture size.** `captureMaxDim:2048` is above the 1,568 px long edge that Claude downsizes images to (inferred), so those bytes are wasted. Use 1,568 or less.
- **Result size.** Claude Code caps MCP tool output (`MAX_MCP_OUTPUT_TOKENS`, about 25k tokens by default) (inferred). The full tree plus 4 images per `browser.run` must fit under it.

### C15. What the sidecar does and does not protect

- **What it does not cover.** The failures that would actually "break Misty" are in the page host, which stays in Misty's process: native input on the main thread, waits on `evaluateJavaScript` completion handlers, and delegates.
- **Fix:**
  - Give every host primitive a time budget on the main thread.
  - Never block the main thread waiting on page JS.
  - Handle `webViewWebContentProcessDidTerminate` as `process.terminated`.
- **Windows.** Misty's Windows path already uses WebView2 DevTools, which is CDP, for frames (report 30, lines 317 and 448). The protocol lists only `macos|linux`, so decide whether Windows is in scope.

### C16. Licensing

The overall position holds.

- **Skyvern.**
  - Only `./LICENSE` exists in Skyvern, so `cli/mcp_tools`, `skills/`, `browser_extension/` and `taskv3/` are all AGPL-3.0.
  - Skyvern names no license version. Under AGPL §14, any published version may be chosen, so combining with Misty's -or-later is fine.
  - Label derived files: "Skyvern portions: AGPL-3.0, version unspecified, §14."
- **Odysseys.** Check the license of the upstream judge code before vendoring it. The dataset's MIT notice does not cover it.
- **BU Bench.** Decrypted tasks pass through the engine provider and Misty's chat history. Check data retention and training settings so the benchmark is not contaminated (inferred).
