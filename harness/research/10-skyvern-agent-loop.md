# 10 - Skyvern: agent loop, planning, completion and workflows

Source studied: Skyvern checkout at `refs/skyvern` (HEAD `cc5ef72b`, committed 2026-11-14). All paths below are relative to that repo root. I read the code and did not run it. Anything I inferred rather than read is marked "(inferred)". The page representation (`domUtils.js`, element tree building) is covered in `11-skyvern-page-representation.md`, so this report only touches it where the loop depends on it.

---

## 0. Summary

Skyvern does not have one agent. It has three engines that sit on top of each other, plus a workflow layer that composes them:

| Engine | Enum (`skyvern/schemas/run_enums.py:14-20`) | Shape | Where |
|---|---|---|---|
| **v1 "step engine"** | `skyvern-1.0` | Each step: scrape the whole page, make one big LLM call that returns a *batch* of actions as JSON, run the batch, then a separate LLM check on whether the goal is met. Mostly stateless between steps. | `skyvern/forge/agent.py` (13.5k lines), `skyvern/webeye/actions/handler.py` (17.6k lines) |
| **v2 "planner"** | `skyvern-2.0` | Outer LLM breaks the user goal into *mini goals* (navigate / extract / loop / compute). Each mini goal becomes a workflow block that runs on v1 (or v3). | `skyvern/services/task_v2_service.py`, `skyvern/forge/prompts/skyvern/task_v2*.j2` |
| **v3 "tool loop"** | `skyvern-3.0` | One persistent conversation with native tool calls (`observe`, `click(ref=N)`, `type`, `look`, `finish`...). Nothing about the page is injected unless the model asks for it. | `skyvern/forge/taskv3/loop.py`, `engine.py`, `tools.py` (26k lines) |
| CUA engines | `openai-cua`, `anthropic-cua`, `ui-tars` | Coordinate-based computer-use models | `agent.py:7325-7680`, `parse_actions.py:484-1650` |

**Why Skyvern is good, and what is worth copying:**

1. **A strict, enumerated action schema** with very detailed per-field guidance. The extract-action prompt spends about 80% of its tokens on *when* to use each action and *when not to* (`extract-action.j2:26`).
2. **Completion is never trusted on the model's word.** A `COMPLETE` action is re-checked by a separate prompt on a freshly re-scraped page (`handler.py:11756-11836`). Steps that did not emit `COMPLETE` are also checked for completion in parallel after every step (`agent.py:11689+`).
3. **Conservative termination.** It has an explicit "do NOT terminate when..." list (`task_v2.j2:29-52`) and a three-way verdict, complete / terminate / continue (`check-user-goal-with-termination.j2:11`).
4. **Specialised mini-agents for the hard widgets.** Custom dropdowns, autocomplete, date pickers, multi-level selects and TOTP each get their own small prompt and loop (`custom-select.j2`, `auto-completion-*.j2`, `handler.py:13204-15910`), so the main planner does not have to drive them click by click.
5. **Planner and executor are separate (v2).** Prompts force a `required_subgoals` checklist that carries forward between iterations, and a "wrap-up mode" kicks in when the budget runs low (`task_v2.j2:81-141`).
6. **The v3 loop is the closest analogue to Misty.** Its protections are numeric: perception-stall, action-loop and page-state-stall guards, size-based elision of old page reads, progress-gated budget extensions, and an evidence-only goal judge at `finish` that never sees the agent's own claims (`loop.py:995-1145`, `goal_check.py`, `taskv3-goal-check.j2`).

Almost none of the *agent-loop* logic depends on CDP. The CDP and Playwright dependencies are concentrated in three places: input dispatch (Playwright `locator.click`/`fill`, which are trusted CDP `Input.*` events), isolated worlds (`Page.createIsolatedWorld` in v3, `tools.py:13660-13830`), and downloads (`skyvern/webeye/cdp_download_interceptor.py`). Each has a direct native-webview equivalent (section 14).

---

## 1. Licensing audit

| Area | License | Evidence |
|---|---|---|
| Repo root, including `skyvern/`, `skyvern-frontend/`, `skyvern-ts/`, `packages/skyvern-ui/`, `integrations/`, `fern/`, `evaluation/`, `skills/` | **AGPL-3.0** | `LICENSE:1-2`. No sub-directory LICENSE files exist (I searched for `LICENSE*` repo-wide, excluding node_modules, and found only the root one). `skyvern-frontend/package.json`, `skyvern-ts/client/package.json` and `packages/skyvern-ui/pyproject.toml` have no `license` field. `pyproject.toml` has no license key either. All of them inherit the root AGPL. |
| README carve-out | AGPL, "with the exception of anti-bot measures available in our managed cloud offering" | `README.md:589-590`. The anti-bot code is simply **not in the repo**. Nothing in the repo is under a different license because of this. |
| `skyvern/forge/sdk/api/llm/ui_tars_llm_caller.py` | **Apache-2.0** (SPDX header, line 2) | Derived from ByteDance UI-TARS. Do not mix it into AGPL derivations without keeping its NOTICE. |
| `skyvern/forge/prompts/skyvern/ui-tars-system-prompt.j2` | **Apache-2.0** (SPDX header, lines 2-7) | Same origin. |
| `evaluation/datasets/odysseys_tasks.json` | **MIT** (upstream ljang0/Odysseys) | `evaluation/datasets/ODYSSEYS_ATTRIBUTION.md`. 200 tasks, rubric-graded (about 6.1 checkpoints per task). This is directly useful for Misty's benchmark step. |
| `evaluation/datasets/webvoyager_*.jsonl` | No attribution file. These are WebVoyager tasks (upstream is a separate project) **(inferred)**. | Check upstream before redistributing. |

**Conclusion:** everything recommended below (prompts in `skyvern/forge/prompts/skyvern/*.j2`, `agent.py`, `handler.py`, `taskv3/*`, `services/*`, `webeye/scraper/domUtils.js`) is AGPL-3.0. Misty is AGPL-3.0, so it can derive these directly. It must keep copyright notices, mark its modifications, and provide source to network users. Keep the two UI-TARS files out of derivations unless we carry the Apache notice.

---

## 2. The v1 step engine: how a task becomes steps

### 2.1 Task inputs

A Task, or any `BaseTaskBlock`, carries these fields (`skyvern/forge/sdk/workflow/models/block.py:2608-2637`): `url`, `navigation_goal`, `data_extraction_goal`, `data_schema` (stored on the task as `extracted_information_schema`), `navigation_payload` (the "user details" JSON), `complete_criterion`, `terminate_criterion`, `error_code_mapping` (user-defined error codes mapped to descriptions), `max_steps_per_run`, `max_retries`, `complete_on_download`, `totp_verification_url`/`totp_identifier`, `complete_verification` (default True), `include_action_history_in_verification` and `include_extracted_text`.

There are two orthogonal goals:
- `navigation_goal` says what to *do*.
- `data_extraction_goal` plus a schema says what to *return*.

If a task has no navigation goal it is a pure extraction task. Step 0 skips the planner entirely and emits a single `ExtractAction` (`agent.py:6224` sets `is_extraction_task = not task.navigation_goal and not ValidationBlock`, and `agent.py:7120-7128` creates the action).

### 2.2 Steps, retries and budgets

- A **step** is a database row `(order, retry_index)`. `execute_step` (`agent.py:4891`) runs one step and then **recurses** into itself for the next step (`agent.py:5492-5530`).
  - On failure, `handle_failed_step` (`agent.py:12069-12206`) creates a new step with the *same order* and `retry_index+1`.
  - On success, `handle_completed_step` creates `order+1, retry_index=0`.
- Budgets, from `skyvern/config.py`:
  - `MAX_STEPS_PER_RUN = 10` (line 195)
  - `MAX_RETRIES_PER_STEP = 5` (line 225)
  - `MAX_NUM_SCREENSHOTS = 10` (line 218)
  - `PROMPT_ACTION_HISTORY_WINDOW = 1` (line 248)
  - `BROWSER_ACTION_TIMEOUT_MS = 5000` (line 143)
  - `BROWSER_LOADING_TIMEOUT_MS = 60000` (line 175)

  Precedence is per-request override, then task, then org, then settings (`agent.py:5009-5015`). There is also a per-workflow-run total cap (`agent.py:12539-12566`).
- When the step cap is reached, `summary_failure_reason_for_max_steps` (`agent.py:12226`) runs an LLM (`summarize-max-steps-reason.j2`) over the screenshot and action history to write a human-readable failure reason and map it to user error codes. `summary_failure_reason_for_max_retries` (`agent.py:12359`) does the same when retries are exhausted.
- If a step emits user-defined `errors` with `terminal_user_errors`, the task fails immediately with no retry (`agent.py:12077-12106`).

### 2.3 One step (`agent_step`, `agent.py:6146-6452`)

1. **Pre-step hooks.** `prepare_step_execution` can *inject* actions (for example a proactive CAPTCHA solve) and skip the LLM (`agent.py:6210`, `7086-7093`).
2. **Speculative plan reuse.** If the previous step's parallel verification already pre-scraped the page *and* ran the planner LLM, that plan is consumed directly (`agent.py:6216-6240`). See 2.5.
3. **Scrape.** `build_and_record_step_prompt` (`agent.py:8856`) runs a scrape ladder `SCRAPE_TYPE_ORDER = [NORMAL, NORMAL, RELOAD]` (`skyvern/constants.py:160`) under one shared navigation deadline (`agent.py:8968`). If the page is blank, the step can recover by injecting a `ClosePageAction` with no LLM call (`agent.py:6252-6283`).
4. **Build the prompt** (`_build_extract_action_prompt`, `agent.py:9358`, detailed in section 3).
5. **Call the LLM** with the prompt and the screenshots (`agent.py:7146-7160`). The JSON reply is parsed with `json_repair`, falling back to `commentjson` (`skyvern/forge/sdk/api/llm/utils.py:376-483`).
6. **Post-LLM interceptors** (`agent.py:7168-7270`):
   - PDF-viewer auto-download. If the page is an `<embed type=application/pdf>` or a `data:application/pdf` iframe, the step emits a `DownloadFileAction` instead of whatever the LLM said.
   - The OTP/TOTP/magic-link handler (`handle_potential_OTP_actions`, `agent.py:12926`).
   - `parse_actions`.
   - If the model returned zero actions but named a mapped error code, the step synthesises a `TerminateAction`.
7. **Run the actions** (`_execute_step_actions`, `agent.py:6454-6913`, section 4).
8. **Finalise** (`_finalize_step_execution`, `agent.py:6954-7037`). If the task has *both* a navigation and an extraction goal, and the step completed the goal, an `ExtractAction` runs before the step is marked complete.

### 2.4 Statelessness and action history

The planner sees only:
- the goal, user details, complete criterion and error codes;
- the **current** page (element tree, screenshots, URL, open tabs, recent JS dialogs);
- the action history of the **previous step only**.

`get_action_history` (`skyvern/services/action_service.py:11-64`) slices `steps[-1 - history_window : -1]` with `history_window = 1`. Each entry is reduced to `{action_type, element_id, status, reasoning, option, download}` plus the result `{success, exception_type, exception_message, download_triggered, needs_followup, committed_option, committed_value, ...}`.

This is Skyvern's main context-management strategy: **the page is the state**. Token growth is O(page), not O(steps). Two exceptions widen the window:
- Completion verification for action-phrased mini goals uses a window covering the full run (`agent.py:7998-8004`).
- The v2 planner keeps its own task history (section 9).

### 2.5 Parallel verification and speculative execution

After a successful step that did not end in COMPLETE or TERMINATE, `_handle_completed_step_with_parallel_verification` (`agent.py:11689`) runs two things at once:
- `check_user_goal_complete`, the goal judge;
- `_speculate_next_step_plan` (`agent.py:7683`), which waits 0.3 s and then scrapes the page and runs the *next* step's extract-action LLM call speculatively.

If the judge says complete, the speculative plan is discarded. If not, the next step consumes the pre-computed plan, which removes one scrape and one LLM call from the critical path. The timeout is `PARALLEL_VERIFICATION_TIMEOUT_SECONDS = 15*60` (`agent.py:438`). A pluggable `gate_step_completion` (`agent_functions.py:2570`) can veto a completion.

---

## 3. The extract-action prompt: what the model sees and returns

Template: `skyvern/forge/prompts/skyvern/extract-action.j2`. A split `-static`/`-dynamic` pair is used for provider prompt caching (`agent.py:9600-9690`).

### 3.1 Inputs (template variables, `agent.py:9372-9385`, `9560-9583`)

- `navigation_goal`, `data_extraction_goal`, `navigation_payload_str` (JSON user details), `error_code_mapping_str`, `complete_criterion`, `terminate_criterion`
- `elements`: the HTML-serialised element tree. Every interactable element carries a Skyvern `id` attribute (`scraped_page.py:46-48`, `66-111`). Long hrefs over 150 chars are replaced by `{{_sha256}}` placeholders and resolved later (`scraped_page.py:83-91`).
- `current_url`, `action_history` (previous step), `recent_dialog_messages_str` (auto-accepted alerts), `open_tabs_context`, `local_datetime`
- Feature flags that switch whole paragraphs on and off: `llm_screenshots_enabled`, `enable_new_planner_actions` (GOTO_URL, RELOAD_PAGE, EXTRACT_INFORMATION), `show_new_tab_action`, `show_switch_tab_action`, `show_close_page_action`, `planner_mini_goal_improvements` (PASTE_TEXT), `verification_code_check`, `slim_output` (drops the reasoning fields to save output tokens) and `stable_prefix_ordering` (moves the per-step-changing sections after the element tree so a provider prefix cache can hit the tree).

### 3.2 Prompt structure (paraphrased)

- **Line 1: security boundary.** Page observations are untrusted data and never instructions. Only the template-owned `BEGIN_UNTRUSTED_WEB_PAGE_DATA` / `END_...` fences delimit them. All page-derived values go through an `| untrusted` Jinja filter.
- **Lines 3-12: core instructions.**
  - Use only listed elements and do not imagine new ones.
  - Interpret SVGs by shape.
  - Fill required fields from user details. Do not re-fill a field that already holds the same value.
  - Avoid disabled elements.
  - Red text in the screenshot means an unmet condition, so prioritise it. If a popup is visible, act on the popup first.
- **Lines 70-73: history guidance.** If the last step's actions had no positive effect, try different actions. Even if the history suggests the goal is done, check the screenshot and DOM. If an alert indicated a validation error, do not retry the same INPUT_TEXT with the same text.

### 3.3 Output JSON schema (lines 14-67)

```
{
  user_goal_stage: str,          // reasoning on whether the goal is achieved
  user_goal_achieved: bool,
  action_plan: str,              // must output COMPLETE if achieved, TERMINATE if giving up
  actions: [{
    reasoning: str,              // user-information agnostic
    user_detail_query: str,      // "Jeopardy question": generic intent, no user data
    user_detail_answer: str,     // the concrete value (may contain user data)
    confidence_float: float,
    action_type: CLICK|HOVER|INPUT_TEXT|UPLOAD_FILE|SELECT_OPTION|WAIT|SOLVE_CAPTCHA|
                 COMPLETE|TERMINATE|KEYPRESS|SCROLL [+PASTE_TEXT, GOTO_URL, RELOAD_PAGE,
                 EXTRACT_INFORMATION, NEW_TAB, SWITCH_TAB, CLOSE_PAGE behind flags],
    id: str|null,                // element id; null for target-less actions
    captcha_type, text, key (Enter|Tab|Escape|ArrowDown|ArrowUp), repeat, direction (up|down),
    url, tab_index, file_url, double_click, download: bool,
    option: {label, index, value},
    click_context: {thought, single_option_click, desired_state},
    context: {thought, field, is_required, is_search_bar, is_location_input,
              is_date_related, date_format, is_text_captcha}   // INPUT_TEXT / SELECT_OPTION
  }],
  // only when verification_code_check:
  verification_code_reasoning, place_to_enter_verification_code,
  should_enter_verification_code, should_verify_by_magic_link
}
```

Fields that drive downstream behaviour:

- **`user_detail_query` / `user_detail_answer`** separate intent from data. They become `Action.intention` and `Action.response` (`parse_actions.py:95-96`). They are used to generate reusable scripts where the value is parameterised (inferred from `script-generation-input-text-generatiion.j2`). The prompt `answer-user-detail-questions.j2` exists but nothing references it; it appears to be dead.
- **`context.*` flags route an INPUT/SELECT to a mini-agent.** `is_search_bar` disables custom-select logic. `is_location_input` enables autocomplete handling. `is_date_related` plus `date_format` drive the date-picker logic (`actions.py:108-116`).
- **`click_context.single_option_click`** marks whether a click depends on user data (radio choice) or not (login button). This matters for script caching. **`desired_state`** makes toggle clicks idempotent.
- **Per-action rules worth copying verbatim in spirit** (all in line 26):
  - WAIT only when there is nothing else to do.
  - KEYPRESS only when no button achieves the same thing.
  - SCROLL only for inner containers, not the page.
  - GOTO_URL must never invent URLs and must be the last action in the batch, because element ids are invalid after navigation.
  - EXTRACT_INFORMATION never goes after page-changing actions.
  - SOLVE_CAPTCHA goes immediately before the protected submit, because tokens expire in about 2 minutes.
  - TERMINATE only when the goal is impossible on this page.

### 3.4 Other step-level templates

`TaskType.validation` uses `decisive-criterion-validate.j2`, which must output exactly one COMPLETE or TERMINATE action. `TaskType.action` first runs `infer-action-type.j2` to classify the single action, then a single-action template such as `single-click-action.j2` or `single-input-action.j2` (`agent.py:9393-9427`).

---

## 4. Running the actions: batch semantics

`_execute_step_actions` (`agent.py:6454-6913`):

- **WAIT filtering.** If a batch contains WAIT alongside other actions, the WAITs are dropped, because WAIT is treated as a failure and would block the batch (`agent.py:6476-6488`). A WAIT-only batch runs (`WaitAction.seconds = 20`, `actions.py:443-445`).
- **Preflight policy check** over the whole batch before anything runs (`preflight_batch`, `agent.py:6492`). This hooks into `browser_action_policy.py` and `browser_effect_approval.py`, which is Skyvern's permission gate.
- **Duplicate-element chaining.** Actions are linked by `element_id`. If an action fails but a later action targets the same element, execution continues so the later one can retry (`agent.py:6497-6507`, `6882-6889`).
- **Stale-target refresh.** For every action after the first, `allow_stale_refresh=action_idx > 0` lets the handler re-locate an element the earlier actions may have re-rendered (`agent.py:6733-6737`).
- **Inter-action delay** is `uniform(base, 2*base)` with base `inter_action_delay` defaulting to 0.5 s. It is skipped after page-level scroll, so scroll-gated "Agree" buttons do not re-disable (`agent.py:6585-6589`, `6790-6810`).
- **Failure policy.**
  - When an action succeeds, its `skip_remaining_actions` can still cut the batch short (for example after navigation or a dropdown commit).
  - When a DecisiveAction (COMPLETE or TERMINATE) fails, the step logs it and continues.
  - When an action fails with `stop_execution_on_failure=False`, the step continues.
  - Any other failure **fails the step**, which leads to a retry with `retry_index+1` (`agent.py:6833-6899`).
- **Focus-sensitive input.** INPUT_TEXT followed by KEYPRESS, or by another action on the same element, sets `skip_auto_complete_tab` so the handler's "press Tab to commit autocomplete" hack does not steal focus (`agent.py:6705-6714`).
- **Page-refresh signal.** A context flag `refresh_working_page` makes the loop reload and abort the batch (`agent.py:6588-6618`).

### Handler-level mini-agents (`handler.py`)

`handle_select_option_action` (11209), `sequentially_select_from_dropdown` (14049), `select_from_dropdown` (15910) and `choose_auto_completion_dropdown` (13204) open a widget and then use an **incremental scrape**. `startGlobalIncrementalObserver` and `getIncrementElements` in `domUtils.js:3908-4018` are a MutationObserver that collects *newly appeared* elements after a click or keystroke. The mini-agent passes those emerging elements to a dedicated prompt:

- `custom-select.j2`: pick the option by visible text and never by autogenerated ids; prefer "Other" when nothing matches; never pick a placeholder for a required field.
- `auto-completion-choose-option.j2`: did suggestions appear, which one, and would a direct search be better?
- `auto-completion-potential-answers.j2`: generate N rephrasings when the typed value does not match.
- `confirm-multi-selection-finish.j2`: has a multi-level select finished?

`input_or_auto_complete_input` uses `MAX_AUTO_COMPLETE_ATTEMP = 1` (`handler.py:13634`; the comment says rephrasing retries are disabled "to speed up skyvern"). This is a key part of why Skyvern handles combobox-heavy forms well. The main planner emits one SELECT_OPTION and the mini-agent handles open, read, choose and confirm.

---

## 5. Vision and the element tree together

- **Default mode is both.** `EnrichTreeMode.CONTROL` is the default (`skyvern_context.py:645-650`, `921`). In CONTROL and ENRICHED_TREE modes `llm_screenshots_enabled_for_prompt` returns True. In `ENRICHED_TREE_NO_IMAGES_FALLBACK` it returns True only when `retry_index > 0`, i.e. images are added on a retry (`skyvern_context.py:1168-1184`).
- **The screenshots are scrolling.** `take_split_screenshots` (`webeye/utils/page.py:2973-2998`) scrolls the page and captures up to `MAX_NUM_SCREENSHOTS = 10` viewport frames. If the trimmed element tree exceeds `DEFAULT_MAX_TOKENS = 100000`, it caps at 1 screenshot (`scraper.py:815-821`). Scroll position is saved and restored around the capture (`scraper.py:840-848`). Bounding-box overlays (`draw_boxes`) are **deprecated**, so the screenshots are plain (`scraper.py:359-362`). The model correlates the image with the tree through text and position, not numbered boxes.
- **Transient popups.** If an ARIA popup is open, scrolling can be suppressed so the popup survives into the next action (`scraper.py:823-838`).
- **Who uses screenshots:** the extract-action prompt ("red text", "popup" rules), the goal check (`without_screenshots` toggle, `check-user-goal.j2:3`), extraction (`extract-information.j2:3`), max-steps summarisation, and task v2 planning and completion.
- **v3 inverts the default.** Text perception (`observe`) comes first. `look` (an annotated viewport screenshot with numbered marks drawn server-side in PIL, never injected into the DOM) is a *last resort*, capped at `_LOOK_MAX_PER_RUN = 20` (`taskv3/tools.py:5608`, `23919-23980`). Its marks are actionable: `click(mark=N)`, `type(mark=N, ...)`.

---

## 6. Completion and verification

There are four layers.

1. **The model's own claim.** `user_goal_achieved` plus a COMPLETE action in the same reply (`extract-action.j2:17-19`).
2. **Forced verification of COMPLETE** (`handle_complete_action`, `handler.py:11756-11836`). Unless `action.verified` is already set, the handler calls `complete_verify`, which:
   - re-scrapes the page with `scraped_page.refresh(draw_boxes=False, scroll=True)` (`agent.py:7980`);
   - unwraps mini-goal templates so the verifier judges the *mini* goal, not the big one (`agent.py:7983-7993`, `MINI_GOAL_TEMPLATE` at `constants.py:144-148`);
   - for action-phrased goals, includes the action history across the full run;
   - renders `check-user-goal.j2`, or `check-user-goal-with-termination.j2` behind a flag, with no Skyvern ids (`html_need_skyvern_attrs=False`).

   If verification says not complete, the result is `ActionFailure(IllegitComplete)`, the step fails and is retried. If it says terminate, the COMPLETE is rewritten in place into a TERMINATE.
3. **Periodic verification after every successful step** (section 2.5), using the same `complete_verify`. It runs only when the step had no decisive action, there is a navigation goal or complete criterion, and the block is not an ActionBlock or complete-on-download (`agent.py:12645-12655`).
4. **Completion gate hook** (`gate_step_completion`) that can veto either path (`agent.py:11768-11784`, `12690-12705`).

**Goal-check prompts:**
- `check-user-goal.j2` returns `{page_info, thoughts, user_goal_achieved}`.
- The termination-aware variant returns `status ∈ {complete, terminate, continue}` plus `failure_categories[]` from a fixed taxonomy: ANTI_BOT_DETECTION, BROWSER_ERROR, NAVIGATION_FAILURE, PAGE_LOAD_TIMEOUT, AUTH_FAILURE, LLM_REASONING_ERROR, CREDENTIAL_ERROR, ELEMENT_NOT_FOUND, WRONG_PAGE_STATE, DATA_EXTRACTION_FAILURE, WEBSITE_ERROR, INFRASTRUCTURE_ERROR, UNKNOWN. That prompt says "continue" is "the most common case".
- When action history is supplied: "achieved only when every described action (including each 'Then:' step) shows as completed successfully" (`check-user-goal.j2:26`).

`Step.is_goal_achieved` requires the step's last action to be a successful COMPLETE or EXTRACT (`skyvern/forge/sdk/models.py:110-125`).

**Termination sources:**
- an LLM TERMINATE action;
- a verifier verdict;
- user-defined `error_code_mapping` errors, which the planner may surface ("Do not return any error that's not defined by the user", `extract-action.j2:85-89`);
- TOTP timeout (`agent.py:7240-7262`);
- the step cap or retry cap, each with an LLM-written reason.

---

## 7. Data extraction

- **Goal plus schema.** `data_extraction_goal` and `extracted_information_schema` (JSON schema, list or string). `ExtractionBlock` requires `data_extraction_goal` (`block.py:17268-17275`).
- **Prompt** `extract-information.j2`. Inputs: goal, schema ("output in the specified JSON schema"; use null for fields it cannot find; add no extra fields), navigation payload, `previous_extracted_information` (accumulates across extractions), elements without Skyvern ids, optional `extracted_text` (page innerText; default True on tasks, False on ExtractionBlock), and optional `virtualized_grid_rows` (a full row harvest for server-windowed data grids). The prompt tells the model to keep `{{hash}}` href placeholders as-is so they can be resolved back to real URLs.
- **Implementation** `extract_information_for_navigation_goal` (`handler.py:16980+`):
  - always `scraped_page.refresh()` first;
  - token ceiling fallback via `load_prompt_with_elements_tracked`;
  - an **extraction cache** keyed on a hash of the exact rendered prompt plus the LLM key, scoped per workflow run and also cross-run in Redis. It is bypassed from the second retry onward (`retry_index > 1`) as a self-heal guard (`handler.py:17064-17074`).
- **Parallel summary.** For pure extraction tasks, `data-extraction-summary.j2` (a one-sentence description of what will be extracted) is prefetched in parallel (`agent.py:6242-6247`).
- **Navigation plus extraction in one task.** Extraction runs after the goal is reached (`agent.py:7004-7024`). Alternatively the planner can emit EXTRACT_INFORMATION and then COMPLETE in one batch, behind a flag.

---

## 8. Token and context management (v1)

- **Hard prompt ceiling** `DEFAULT_MAX_TOKENS = 100000` (`constants.py:161`). Over the ceiling, `load_prompt_with_elements_tracked` (`skyvern/utils/prompt_engine.py:92-215`) walks a degradation chain:
  1. full tree;
  2. **economy tree**, which drops secondary elements such as SVG;
  3. economy tree truncated to its **first 2/3** at a tag boundary (`_truncate_elements_at_tag_boundary`, line 242);
  4. `_trim_elements_to_fit` / `enforce_prompt_ceiling`, which can null out optional fields such as previous extracted info, schema and extracted text.
- **Lean tree** (`build_lean_elements_tree`, `scraped_page.py:516`): compress image src, strip URL query strings, drop non-navigable hrefs; hrefs are kept for the planner (`agent.py:9505-9520`).
- **History window of 1 step** (section 2.4). Action records are projected to a small field set.
- **Prompt caching.** Static and dynamic halves are split. Anthropic cache markers and a Vertex explicit cache for Gemini are supported, as is `stable_prefix_ordering` (`agent.py:9440-9690`).
- **Output tokens.** `slim_output` modes `safe` and `terse` remove `user_goal_stage`, `action_plan` and the `thought` fields, and cap reasoning at 15 words (`extract-action.j2:16-22`).
- **Per-call-type model keys.** `config.py:521-540` defines separate keys for primary, secondary, select-agent, single-click, single-input, extraction, check-user-goal, auto-completion and others. Cheap models can do the mini-agent and judge work.

---

## 9. Task v2: the planner (task to mini goals to blocks)

`run_task_v2_helper` (`skyvern/services/task_v2_service.py:923`). The loop runs up to `DEFAULT_MAX_ITERATIONS = 50` iterations (`:183`, loop at `:1118`). An override can only raise the limit (`:853-867`).

Each iteration:
1. Check for cancellation.
2. Get the browser state. If the page did not load, fall back to Google (`:1136-1175`). On iteration 0, if the browser is not at the URL, synthesise a `goto_url` task.
3. Scrape the page and render `task_v2.j2` with the user goal, current URL, open tabs, elements, **task history** (all previous mini tasks with status, reason and extracted data) and `prior_required_subgoals`.

**Planner output** (`task_v2.j2:73-97`):
- `page_info`, `extraction_thought`, `require_extraction`, `task_history_information`, `information_extracted`, `thoughts`
- **`required_subgoals: [{subgoal, satisfied, evidence}]`**
- `user_goal_achieved` (true only if every subgoal is satisfied)
- `should_terminate` plus `termination_reason`, which must *quote the exact page text*
- `plan` (the mini goal)
- optional `complete_criterion` for navigate tasks
- `task_type ∈ navigate|extract|loop|compute`
- `loop_values`, `is_loop_value_link`

**Rules that matter:**
- **Navigate never extracts.** "A navigate task's job is to GET TO the right page" (`:6`). Extraction is a separate task type.
- **Prefer loops.** Repeated same-shape work is one loop, not N tasks, because separate tasks exhaust the budget (`:8-17`).
- **Respect caps.** If a page caps items per operation, split into segments (`:19`).
- **Mini-goal authoring rules** (behind the `planner_mini_goal_improvements` flag): the inner agent sees *only* the plan, so copy concrete parameters into it; one substantial objective per page; end with the success condition; fit in the inner step budget (`:20-27`).
- **Conservative termination.** Explicit allowed and disallowed lists (`:29-52`).
- **No "summarise" tasks.** The final answer is composed automatically at completion. Planning extract tasks to "summarise" loops forever (`:60-65`). `compute` tasks run deterministic code over gathered data (`_generate_compute_task`, `:2333`, with an `_assert_compute_code_safe` sandbox check at `:2296`).
- **Carry the checklist forward.** Previous subgoals are refined, not re-derived (`:130-133`).
- **Wrap-up mode.** Within the last `converge_pct`% of iterations, the planner works only unsatisfied subgoals (`_converge_iterations_remaining`, `:870-880`; prompt `:134-141`).
- **Max-steps is not impossibility.** A mini goal that hit max steps should be re-planned *more specifically* (for example type the date instead of using the calendar) and not re-issued unchanged (`:127-129`).

**Executing a mini goal.** Navigate becomes a `NavigationBlock` whose `navigation_goal = MINI_GOAL_TEMPLATE.format(main_goal, mini_goal)` (`:1397`). Extract becomes an `ExtractionBlock`. Loop becomes a `ForLoopBlock` over the extracted `loop_values`, where each iteration runs a nested planning session (`_generate_loop_task`, `:1944`). Each block runs through the workflow engine on v1 steps.

After a successful block, `task_v2_check_completion.j2` runs as a completion check (`:1598-1617`). It uses the same `required_subgoals` structure plus `failure_categories`. When the goal is achieved, `task_v2_summary.j2` writes the deliverable (`_summarize_task_v2`, `:3179`).

---

## 10. Workflows and blocks

`BlockType` (`skyvern/schemas/workflows.py:541-576`) includes:
- browser and agent blocks: task, task_v2, navigation, extraction, login, action, validation, file_download, goto_url, wait, human_interaction, print_page, agent_step;
- control flow: for_loop, while_loop, conditional, terminate, workflow_trigger;
- data and other: code, text_prompt, http_request, web_search, pdf/file parsers, S3, email and sheets blocks.

Browser blocks share one browser across the run. A block with no URL continues on the current page (`resolve_inherited_workflow_task_page`, `agent.py:465-499`).

| Block | What it is | Key details |
|---|---|---|
| `NavigationBlock` (`block.py:17260`) | A task with a required `navigation_goal` | Runs v1 steps; stops on a verified COMPLETE |
| `ExtractionBlock` (`:17268`) | A task with only `data_extraction_goal` and `data_schema` | Single extract action; optional Parquet export |
| `LoginBlock` (`:17387`) | A navigation task with credential parameters | **If a saved browser profile was loaded, the goal is rewritten to "A saved browser session has been loaded. Check if the user is already logged in. If already logged in, complete this task immediately..."** (`skyvern/forge/sdk/workflow/service.py:11398-11410`). `preflight_failure_reason` treats a reused profile or persistent session as a valid source of login (`block.py:17397-17406`). This is the pattern Misty needs for its profile-only design. |
| `ValidationBlock` (`:17199`) | `TaskType.validation`, which renders `decisive-criterion-validate.j2` and must emit exactly one COMPLETE or TERMINATE | Cannot be the first block. `without_page_information` validates against workflow data only. |
| `ActionBlock` (`:17251`) | A single action with an optional CSS `selector` and `ai_fallback` mode (fallback or proactive) | No goal verification (`agent.py:6977`) |
| `ForLoopBlock` (`:3911`) | `loop_over` parameter, `loop_blocks`, `complete_if_empty`, `data_schema` | Cap `DEFAULT_MAX_LOOP_ITERATIONS = 1000` (`:1137`, `:4521`). Natural-language loops extract `loop_values` via `extraction_prompt_for_nat_language_loops.j2`. Per-block `continue_on_failure` and `next_loop_on_failure` (`:1310`, `:1329`). |
| `WhileLoopBlock` (`:4986`) | Condition-driven loop, same 1000 cap | |
| `FileDownloadBlock` (`:17466`) | `complete_on_download` | The task completes when a download lands |

Goal fields are Jinja templates (`TEMPLATABLE_FIELDS`, `block.py:2640-2654`) rendered against workflow parameters and earlier block outputs, which is how data flows between blocks.

---

## 11. Task v3: the tool-calling loop (the closest analogue to Misty)

`skyvern/forge/taskv3/loop.py:1-12` describes it as one persistent LLM conversation driving browser tools via native tool calls, where perception is a tool the model chooses to call. The step engine, by contrast, scrapes every step.

**Tools** (`taskv3/tools.py:24835-25100`, `auth_tools.py`, `captcha_tools.py`): `observe`, `get_html` (selector or whole page; `format:"text"` for visible text; 20,000-char windows with offset continuation, `HTML_MAX_CHARS = 20000` at line 226), `look`, `click`, `hover`, `drag`, `type`, `select_option`, `select_combobox` (types, waits for suggestions, picks the best match, verifies the commit), `press_key`, `scroll`, `wait`, `navigate`, `file_upload`, `get_verification_code`, `open_verification_link`, `solve_captcha`, and `finish(status, reason, extracted_output)`.

**`observe` output.** Each element line is `ref=N`, label, type, current value, options, plus `near=[slot:text]` projected-slot text. A ref "keeps working while that element is on the page; if it becomes ambiguous or is gone, the tool errors instead of acting on something else" (`tools.py:206-217`).

**System prompt** (`taskv3/engine.py:155-176`), paraphrased:
- Observe once per page state and act from that snapshot.
- Batch aggressively: a whole form section in one turn.
- Use `select_combobox` for typeahead fields and never raw-type into them.
- `get_html` is a last resort; `look` is for genuinely visual problems.
- "Inspecting the page does NOT progress the task."
- Before `finish(completed)`, re-observe that the effect is present in **settled** content.
- Retry a rejected submit at most once.
- Never invent addresses, phones, government IDs or financial data. For a missing birth date, use 01/01/<year>.
- Do not submit irreversible actions unless instructed.

**Budgets** (`engine.py:113-149`):
- `DEFAULT_MAX_TURNS = 80`, `DEFAULT_MAX_TOOL_CALLS = 300`, `DEFAULT_DEADLINE_SECONDS = 1800`, `DEFAULT_MAX_TOKENS = 1.5M` (cumulative sent), `DEFAULT_MAX_CALL_RETRIES = 2`.
- An action-step budget is floored at `MIN_ACTION_STEPS = 24`. The comment says 24 is the lowest cap with a measured success rate, above the p95 of 15-18 rounds.
- Turns scale at 6 per action step and tool calls at 25 per action step. Tokens scale and are capped at `4 × 1.5M`. The re-sent prefix is charged only up to `PREFIX_REF_TOKENS = 20_000`.

**Loop guards** (`loop.py:995-1145`):
- `NO_TOOL_CALL_NUDGE` when the model replies with prose instead of a tool call.
- **Perception stall:** identical canonicalised snapshots from the same probe. Nudge after 6, terminate after 15.
- **Action loop:** the same tool and arguments with no evidence of page change. Nudge after 3, terminate after 8. The comment is explicit that 8 sits above everything observed and must not be lowered without data.
- **Page-state stall:** the main-frame fingerprint is unchanged. Nudge after 8, would-terminate after 12, shadow-only for now because it is blind to iframes.
- **Navigation dead end** on HTTP 404/410 only. 401, 403, 429 and 5xx are treated as recoverable.
- **Progress-gated budget extension:** if the step cap is hit while the page is demonstrably still changing (within the last 8 rounds), grant +50% of the *original* cap, repeatedly, up to 3× total.

**Context management** (`loop.py:1011-1022`): page reads the model has already seen are retained **by size**. When retained bodies exceed `PERCEPTION_RETAIN_CHARS_HIGH = 40k`, the oldest are elided down to `LOW = 20k` in one rewrite ("epoch"). The newest 2 reads are always kept. Between epochs the transcript only grows at the end, so provider prefix caches keep hitting.

**Finish gate:**
- `goal_check.py` runs an LLM judge with `taskv3-goal-check.j2`. The judge sees only the last `TRAIL_SIZE = 8` tool calls with their *results*, the most recent page read (capped at 16,000 chars) and a screenshot taken at finish.
- It **never sees the agent's reason or its typed values** (`goal_check.py:1-4`).
- Verdict is `achieved | not_achieved | impossible`. Non-achieved verdicts must quote the page character for character, or use `SCREENSHOT: ...`.
- Rules: absence is not a contradiction; a search-box echo does not show the effect; a read taken before the last action does not count.
- Timeout `GOAL_CHECK_TIMEOUT_SECONDS = 20`.
- Companions: `taskv3-unlisted-outcome-check.j2` (did the site skip a screen the criterion expects?) and `taskv3-terminate-premise-check.j2`.

**Isolated worlds.** v3 runs its probes in a per-page isolated world because "a forged label earns a forced click through a real cover" in the main world (`tools.py:13655-13670`). It does this through CDP: `new_cdp_session`, a frame-tree lookup and an isolated world per frame (`tools.py:13681-13830`).

---

## 12. Self-healing in Skyvern

- **Cached scripts with an AI fallback.** Workflows can be compiled into cached Python code per block. On failure, `_fallback_to_ai_run` (`skyvern/services/script_service.py:1597`) reruns the block with the AI agent, passing the block's goal, criteria, schema, error codes and max steps.
- **Regeneration.** Inline regeneration after a fallback (`_regenerate_script_block_after_ai_fallback`, `:2052`) is **disabled** (`:2088`, "skipping script regeneration after AI fallback"). Improvement is delegated to a post-run reviewer (`script_reviewer.py`, `script_reviewer_v3/`, prompts `script-reviewer*.j2`).
- **Triage.** `script-failure-triage.j2` classifies a failed script plus failed AI fallback as `CODE_FIXABLE` or `NOT_CODE_FIXABLE`.
- **Reliability metrics.** `skyvern/schemas/self_heal.py:47` sets `RELIABILITY_WINDOW = 20` runs. `compute_workflow_reliability` (`:231`) computes heal rate, consecutive healed runs, "floor" engine runs, and outcome risk over the last 10.
- **Inside a run:**
  - the extraction cache is bypassed from retry 2 onward;
  - screenshots can be enabled on retry;
  - completion verification failures trigger a retry;
  - a step that hit max steps is re-planned more specifically by v2.

---

## 13. How each mechanism depends on CDP or Playwright

| Mechanism | Dependency | Native-webview path |
|---|---|---|
| Step loop, retries, budgets, history window, all prompts and parsing | **none** | Port as-is in the sidecar |
| Element tree extraction (`domUtils.js`) | **none** (pure JS) | Inject into a WKContentWorld / WebKitGTK script world; one evaluation per frame via WKFrameInfo |
| Incremental MutationObserver ("emerging elements") | **none** | Same JS in the isolated world. MutationObservers registered in an isolated world see main-world DOM mutations, because the DOM is shared (inferred). |
| Scrolling screenshots (Playwright `page.screenshot`) | **partial** | JS `scrollTo` then WKWebView `takeSnapshot(with:)` per viewport, then restore `scrollX/Y`. On WebKitGTK use `webkit_web_view_get_snapshot`. |
| Click, type, hover, keypress (Playwright locator, i.e. CDP `Input.dispatch*`) | **hard** in Skyvern's code, but replaceable | Resolve the element rect in JS (account for devicePixelRatio and iframe offsets) and post native NSEvent mouse and key events to the view (trusted). Use JS `focus()`/`setRangeText` for value commit as a fallback. |
| Isolated world for tamper-resistant probes (v3: `Page.createIsolatedWorld`) | **hard** (CDP) | WKContentWorld is exactly this, and simpler: no frame-id bookkeeping |
| Cross-frame evaluation | partial (Playwright Frame) | WKFrameInfo-targeted `evaluateJavaScript(in:in:)` reaches cross-origin frames on macOS |
| JS dialogs (auto-accept plus `recent_dialog_messages`, `handle-dialog.j2`) | partial (`page.on('dialog')`) | WKUIDelegate `runJavaScriptAlert/Confirm/TextInputPanel` |
| Downloads (`cdp_download_interceptor.py`, 4.2k lines) | **hard** | WKNavigationDelegate `navigationResponse` with `shouldPerformDownload`, then WKDownload delegate |
| PDF auto-download (embed or data-URI detection) | none for detection | Fetch the URL natively with cookies from WKHTTPCookieStore, or decode the data URI |
| Multi-tab (NEW_TAB, SWITCH_TAB, CLOSE_PAGE) | partial (Playwright pages) | WKUIDelegate `createWebViewWith` returns a new view on the same data store; tab registry in the host |
| Navigation status (v3 404/410 dead-end) | partial | `WKNavigationResponse.response` as HTTPURLResponse `statusCode` |
| Speculative pre-scrape and plan | none | Same, but it needs the engine to accept a "pre-computed observation" |
| Page-state fingerprint (`innerHTML` hash) | none | JS |
| Network egress policy and monitor (`browser_egress_policy.py`) | hard (request interception) | WKContentRuleList for blocking only; no body visibility |

---

## 14. Recommendations for Misty

Misty's engines (Claude Code, Codex) are the model, and the harness exposes MCP tools. **Architecturally, Misty is Skyvern v3, not v1.** v1's "single JSON action batch per step" assumes the harness owns the LLM call. With an engine on the other side of MCP, our lever is tool design, tool-result content and harness-side guards and judges.

1. **Derive v3's tool surface and descriptions** (`taskv3/tools.py:206-260`, `24835-25100`, `engine.py:155-176`). Specifically:
   - `observe` with stable `ref=N` handles that fail loudly when stale;
   - a `select_combobox` composite;
   - `get_html` with a text mode and offset windows;
   - `look` as a capped last resort with numbered marks drawn host-side on the snapshot.
2. **Put the composite widget logic inside tools.** Skyvern's mini-agents (custom select, autocomplete, date pickers, multi-select confirm) are where its form reliability comes from. In Misty they should run harness-side in the sidecar: open, MutationObserver emerging-elements diff, choose, verify commit. They can call the engine back through the proxy for the choice prompt (`custom-select.j2`, `auto-completion-choose-option.j2`) or use deterministic text matching first.
3. **Add a finish judge that sees evidence only.** Derive `taskv3-goal-check.j2` and `goal_check.py`: the last 8 tool results, the last page read and a `takeSnapshot`, and never the agent's own claims. This also answers the user's requirement that judging follows benchmark rules. Use a separate *benchmark* judge for scoring and keep this one as an in-run gate.
4. **Port the loop guards with the same numbers.** Perception-stall 6/15, action-loop 3/8, page-state-stall 8/12 (shadow mode), progress-gated budget extension, and a 404/410-only dead end. These can be MCP-side: the sidecar counts identical tool results and injects a nudge into the tool result text.
5. **Size-based elision of old page reads** (20k/40k chars, keep the newest 2) applies if Misty's sidecar mediates history. If the engine (Claude Code) owns the transcript, the equivalent is keeping tool results compact and stable-prefixed (inferred).
6. **Mirror v2 planning in the engine prompt or skill.** The `required_subgoals` checklist, "navigate never extracts", loop preference, no "summarise" tasks, a compute step for arithmetic, wrap-up mode, and re-planning more specifically after max steps. This is cheap: it is prompt text for the Misty browser skill.
7. **Profile-only login** (Misty requirement 4). Copy the LoginBlock rewrite (`workflow/service.py:11398-11410`): when a persistent website data store is loaded, the first instruction is "check if already logged in; if so, complete immediately". Never require credentials when a profile is attached (`block.py:17397-17406`).
8. **Self-heal.** Adopt the pattern of recording a successful run's action trail with intent and value separated (`user_detail_query`/`answer`, `single_option_click`), replaying it, falling back to the agent on divergence, and triaging failures as CODE_FIXABLE or not. Skip Skyvern's inline regeneration, which Skyvern itself disabled. Track reliability over a 20-run window.
9. **Benchmarks.** Skyvern vendors Odysseys (MIT, rubric-graded, 200 tasks) and WebVoyager under `evaluation/`. Reuse the dataset loaders, but the judge must follow the Odysseys paper's rubric protocol.

---

## 15. Open questions

- Does WKWebView `takeSnapshot` capture content inside cross-origin iframes and video and canvas reliably enough for a `look` equivalent? Skyvern's v3 relies on Playwright's compositor screenshot.
- Are trusted NSEvents posted to an off-screen or background WKWebView (a sidecar with hidden windows) delivered the same way as foreground events? Skyvern never faces this because CDP input is window-agnostic.
- v3's page-state stall is shadow-only because it is blind to iframes. With WKFrameInfo we could fingerprint every frame. Is that worth making live?
- Skyvern's numbers (24 action-step floor, 8-step action-loop cap) were measured with their models and prod mix. They need re-validating against Opus 5.5 driving via MCP.
- `answer-user-detail-questions.j2` is unreferenced. Is it dead, or used by cloud-only code that is not in the repo?
- WebVoyager datasets have no attribution file, so their license needs confirming before redistribution.
