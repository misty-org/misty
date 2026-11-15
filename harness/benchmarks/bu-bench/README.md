# BU Bench with Misty's harness

[`misty_eval.py`](misty_eval.py) runs [BU Bench V2.1](https://github.com/browser-use/benchmark)
with Misty's own browser in place of BrowserCode. The judge, its model and the scoring are the
benchmark's own code, unchanged. This file only runs each task and saves the evidence the judge
reads: the run's steps, the final answer, screenshots and deliverable files.

Each task is an ordinary agent run on one of Misty's engines (Claude Code by default), started in
the debug app through its eval bridge. The engine is the brain and Misty's browser tools do the
browsing, so the score measures the engine's model with Misty's harness. Always report both.

## Setup

1. BU Bench is the submodule [`browser-use-benchmark/`](browser-use-benchmark), pinned to
   v2.1.1: this repository points at its commit and copies none of its code. From
   `misty-browser-harness/`, fetch and install it:

   ```bash
   git submodule update --init benchmarks/bu-bench/browser-use-benchmark
   ```

   ```bash
   cd benchmarks/bu-bench/browser-use-benchmark && uv sync --frozen --python 3.12 && cp .env.example .env
   ```

   Set `OPENAI_API_KEY` in `benchmarks/bu-bench/browser-use-benchmark/.env` (BU Bench's git ignores it). The
   judge (`gpt-5.6-luna`, xhigh) needs it. `BROWSER_USE_API_KEY` isn't needed: no Browser Use
   service is used.

2. Start Misty's debug app (from `misty/`) with the eval bridge on. The token is any random string of at least 24
   characters; the bridge isn't compiled into release builds.

   ```bash
   export MISTY_BROWSER_EVAL_BRIDGE_TOKEN=$(openssl rand -hex 24)
   ```

   ```bash
   MISTY_BROWSER_EVAL_BRIDGE_PORT=47123 npm run tauri dev
   ```

3. In the app, use an account kept for benchmarking, with a profile kept for benchmarking: runs
   browse in the window's profile, and the chats they leave contain the decrypted tasks. Send the agent you'll benchmark (for
   example the Claude Code agent) one message, so it has a folder. Deliverables are saved in
   `<agent folder>/bu-bench/<run>/` during a task, then copied out and deleted.

## Running

From `misty-browser-harness/`, in the same shell (so the token is set). The Misty checkout is
found beside it; pass `--misty <path>` otherwise.

```bash
uv run --project benchmarks/bu-bench/browser-use-benchmark python benchmarks/bu-bench/misty_eval.py --store fresh --profile Benchmark --check
```

```bash
uv run --project benchmarks/bu-bench/browser-use-benchmark python benchmarks/bu-bench/misty_eval.py --store fresh --profile Benchmark --tasks 5
```

`--store` has no default, because one choice erases data:

- **`fresh`** clears the profile's cookies, site storage and cache before every task (Misty's
  Settings → Clear website data), so each task starts in a clean browser, as BrowserCode's do.
  These are the scores to compare with other harnesses. It erases that profile's sign-ins, so it
  asks for `--profile` with the profile's name and stops if the window belongs to another one.
  It runs one task at a time.
- **`signed-in`** browses with the profile's own sign-ins, kept between tasks: what Misty does
  for a person. Report these scores apart; they aren't comparable with a clean-browser run.

Options:

| Option | Default | |
| --- | --- | --- |
| `--bench` | `browser-use-benchmark/` | Another BU Bench checkout, for another revision |
| `--engine` | `claude` | Runs as that engine's agent (`personal_engine_<engine>`) |
| `--agent` | | A specific agent id instead |
| `--model`, `--effort` | the agent's | The engine's model and reasoning effort |
| `--permission-mode` | `bypass` | The engine's mode; nobody is there to approve steps |
| `--store` | required | `fresh` or `signed-in`, above |
| `--profile` | | With `fresh`: the name of the profile it clears |
| `--window` | the first window | The app window runs start from; its profile is the one used |
| `--tasks`, `--task-ids` | all 200 | Same as `run_eval.py` |
| `--shard-index`, `--shard-count` | | Same as `run_eval.py` |
| `--task-timeout` | 3600 | Seconds per task |
| `--parallel` | 1 | Runs at once in the app |
| `--judge-model`, `--judge-reasoning` | the benchmark's | Change only to match another run |

Results go to `benchmarks/bu-bench/run_data/BU_Bench_V2_misty_<time>/` (git ignores it), in the layout `run_eval.py` uses:
`config.json`, `results.json`, and per task `events.jsonl`, `trace.json`, `screenshots/`,
`screenshot_manifest.json`, `workspace/outputs/`, `judge_input.json`, `judge_response.json` and
`result.json`. They contain decrypted tasks and rubrics: don't publish or commit them.

## How it differs from a BrowserCode run

- **Screenshots** are the pictures Misty already takes after each browser step for the activity
  view (Misty's `run_control/step_pictures.rs`). It takes at most one every 1.2 seconds and skips pictures
  over 400 KB, so some steps have none, and they are taken on macOS only. Each task's judge input
  says how many steps are missing one. When Misty's step count and the run's tool events don't
  line up, screenshots go to the judge in order without step numbers, which the judge supports.
- **The prompt** is the benchmark's BrowserCode prompt with Misty's browser in place of
  BrowserCode's, plus: don't ask questions, and don't use the engine's own web fetch or search.
  That last part is only an instruction, so the runner checks: a task whose run called a web
  fetch or search tool, or a shell command that reaches a URL, gets `contaminated` in its
  `result.json` with the steps, and the run lists those tasks. Report them apart from the score.
- **Cost** is what the engine reports (Claude Code reports it; others may report nothing).
- **Fresh browser per task:** BrowserCode starts a clean browser per task. `--store fresh` clears
  the profile's stored data instead; pages still open from an earlier task keep what they hold
  in memory until they close. `--store signed-in` keeps everything between tasks.

Only compare scores on the same task set, revision and `browser_store`, with the judge settings
in `config.json`.
