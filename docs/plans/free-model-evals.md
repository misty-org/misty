# Free-model evals

How Misty's benchmarks run without paid model credit. Written October 20, 2026, when the
Anthropic credit the Odysseys campaign ran on was down to about $25 of $100.

## Decision

Evals run on **NVIDIA's hosted models** (build.nvidia.com), which are free with a rate limit, through
a new `nim/` model route. **`nim/z-ai/glm-5.3-flash` is the agent and the judge** (decided
October 20): 320B parameters with 18B active, a 1M context, image input and tool calling, with
thinking always on. Both jobs need images: the agent gets screenshots back from its tools, and the
judge grades from up to 60 screenshots a task.

One model grading its own runs leans generous. A before/after comparison on the same agent and
judge cancels that out, so it doesn't matter here; it does when comparing across models or with
published scores, and then the judge should come from another family.

Fallbacks, if GLM-5.3-Flash fails the smoke check or NVIDIA stops serving it:

| Model | Size | Notes |
|---|---|---|
| `nim/z-ai/glm-5.3` | Larger GLM | Try first: worth it if it takes images (no model card confirms that) |
| `nim/nvidia/nemotron-3.5-super-vl-120b-a12b` | 120B, 12B active, 1M context | NVIDIA's own vision model, released October 15 |
| `nim/moonshotai/kimi-k2.6` | 1T, 32B active, 256k context | Listed, but some accounts get 404 "Function not found for account"; NVIDIA's forum reports enabling "Public API Endpoints" fixes it |
| `nim/google/gemma-4-31b-it` | 31B dense, 262k context | Smallest; expect lower scores |

Text-only models on the list (DeepSeek V4.1 Flash, Nemotron 3 Ultra, GPT-OSS 20B) fail on the
agent's screenshots.

| Provider | Free allowance (October 2026) | Why not / why |
|---|---|---|
| **NVIDIA NIM** | About 40 requests a minute per key, no daily cap reported, no card | **Chosen.** Vision and tool-use models (above); OpenAI-compatible; a run's 40,000-token turns fit |
| OpenRouter `:free` | 20 a minute and 50 a day, or 1,000 a day after a one-time $10 purchase | 50 a day is under one Odysseys task |
| Gemini free tier | Flash only since April 2026; sources give 20 to 1,500 a day | Too uncertain to plan a pass on |
| Cerebras, Groq | About 1M tokens a day | One Odysseys task is 2–3M tokens |
| Local (Ollama) | Unlimited | The Windows machine has an 8 GB RTX 3070; nothing that size handles 50k-token agent turns well |

None of these is the house model, Haiku 5.5, so **scores on them are not comparable to batches 1–20
or passes A and B.** Every comparison runs both sides on the same agent and judge.

Caveats:
- NVIDIA may log free-tier traffic. Odysseys tasks are public and the eval's browser profile has no
  sign-ins, so nothing private goes out. Never point a personal account at a `nim/` model.
- Free endpoints can be slow or change models without notice. Run `npm run eval:free-model` before
  a pass; it takes about a dozen requests.
- Web search still bills Serper (about $0.001 a search, with a free starting allowance).

## How it works

- **Runtime** (`server/apps/agent-runtime/src/model-provider.ts`): a `nim/<org>/<model>` id with
  `NVIDIA_API_KEY` set calls NVIDIA's chat completions (`NVIDIA_BASE_URL` overrides the endpoint).
  The reasoning effort is not sent, and screenshots in tool results move to a user message right
  after them, since chat completions only carry text in tool results. Without the key, the id goes to
  the AI Gateway, which doesn't know it.
- **Server** (`server/internal/agents/house_route.go`, `FreeEvalModel`): a development stack with
  `MISTY_ALLOW_MODEL_OVERRIDE=1` accepts `nim/` ids that aren't in the Gateway catalog. Production
  never does.
- **Billing** (`misty-billing/compose.dev.yml`): the dev billing service prices the models in the
  table above and GLM-5.3-Flash at zero, so the eval account never runs out of usage. Add
  any other `nim/` model there before using it.
- **Eval**: `spend.ts` counts `nim/` models as free. The judge grades rubrics one at a time on a
  `nim/` model, so a rate-limit 429 isn't graded as a failed rubric.
- **Other server-side calls**: page extraction, screenshots and compaction go through the runtime on
  the run's own model. Conversation titles and other small calls use `MISTY_AI_LOW_MODEL`; set it to
  the `nim/` model too, so nothing touches paid credit.

## Setup

1. Make a free key at <https://build.nvidia.com> (an NVIDIA account; no card).
2. In `server/.env/dev/integrations/ai.env` add `NVIDIA_API_KEY=nvapi-…` and
   `MISTY_AI_LOW_MODEL=nim/z-ai/glm-5.3-flash`. In `server/.env/dev/runtime.env`, check
   `MISTY_ENVIRONMENT=development` and add `MISTY_ALLOW_MODEL_OVERRIDE=1`.
3. Pull `misty-billing` as well, and restart its dev stack so the zero prices load.
4. Check the model with the smoke check, from `server/apps/agent-runtime` (GLM-5.3-Flash is its
   default; `MISTY_FREE_MODEL=nim/…` checks a fallback):

   ```bash
   NVIDIA_API_KEY=nvapi-… npm run eval:free-model
   ```

   All four checks must pass: a tool call, a screenshot from a tool, the 32,000-token output cap,
   and 20 screenshots in one message. If only the output cap fails, cap `maxOutputTokens` in the
   `nim/` branch of `model-provider.ts`; otherwise try the fallbacks in order.
5. Run Odysseys as in its README, with `MISTY_ODYSSEYS_MODEL=nim/z-ai/glm-5.3-flash`,
   `MISTY_ODYSSEYS_JUDGE=nim/z-ai/glm-5.3-flash`, `MISTY_ODYSSEYS_PARALLEL=2`, and `NVIDIA_API_KEY`
   in the eval's shell. Agent and judge share one rate limit (about 40 requests a minute); on
   429s, drop to `MISTY_ODYSSEYS_PARALLEL=1`.

## Why the comparison runs on the Mac

Batch 17 and every Odysseys number so far ran on the Mac, in WebKit. On Windows, Misty can't yet read
or act inside cross-origin frames (`src-tauri/src/infra/browser_frames.rs` reports none off macOS).
At least two of the ten dev tasks need that (`48a6cb73b8` and `d03a08650b`, the CryptPad documents).
A Windows pass would measure the platform, not the harness. Windows gets its own baseline once
frames work there.

## Prompt for the Mac rerun

Paste this into Claude Code in the `misty` checkout on the Mac:

> Rerun the Odysseys comparison on GLM-5.3-Flash, NVIDIA's free hosted model, following `docs/plans/free-model-evals.md` and
> `server/apps/agent-runtime/evals/odysseys/README.md`. Paid model credit is nearly gone: use only
> `nim/` models, and stop and tell me if anything would spend on Anthropic, OpenAI or the AI Gateway.
>
> 1. Pull `main` in `misty` and in `misty-billing`. Set up the free model as in the doc's Setup
>    section: I've put `NVIDIA_API_KEY` in `server/.env/dev/integrations/ai.env`; check that it,
>    `MISTY_AI_LOW_MODEL`, `MISTY_ENVIRONMENT=development` and `MISTY_ALLOW_MODEL_OVERRIDE=1` are
>    there without printing the key. Run `npm run eval:free-model` and stop if any check fails; if
>    only GLM-5.3-Flash fails, tell me which fallback from the doc passes before going on.
> 2. Start the stack (`misty server up`) and the desktop app in debug mode with the eval bridge and
>    `MISTY_EVAL_EPHEMERAL_PAGES=1`, as the README says. Restart the app before each pass (the
>    WebKit page-process leak in odysseys-campaign.md is still open).
> 3. **Before:** check out the commit just before "One verification turn before a finish stands"
>    (the free-model route must already be in it), rebuild the runtime, and run batch 17's ten
>    tasks: dev split, `MISTY_ODYSSEYS_LIMIT=10`, `MISTY_ODYSSEYS_OFFSET=0`, agent and judge both
>    `nim/z-ai/glm-5.3-flash`, `MISTY_ODYSSEYS_PARALLEL=2`, `MISTY_ODYSSEYS_EARLY_STOP=0`.
> 4. **After:** check out `main` again, rebuild the runtime, restart the app, and run the same ten
>    tasks with the same settings.
> 5. Report both passes side by side: perfect tasks, rubric average, median run time, median tool
>    calls, finish refusals (`finish_verified` and `run_finish` in the runtime log), loop-guard notes,
>    and any 429s or judge errors. Name the tasks that rose or fell and why, from the judge's
>    reasoning. Add the results to the log in `docs/plans/odysseys-campaign.md`, naming the agent
>    and judge models (not Haiku). Don't commit or push without asking.
