# BU Bench with Misty's harness

[`misty_eval.py`](misty_eval.py) runs [BU Bench V2.1](https://github.com/browser-use/benchmark)
with Misty's own browser in place of BrowserCode. The judge, its model and the scoring are the
benchmark's own code, unchanged. This file only runs each task and saves the evidence the judge
reads: the run's steps, the final answer, screenshots and deliverable files.

Each task is an ordinary agent run on one of Misty's engines (Claude Code by default), started in
the debug app through its eval bridge. The engine is the brain and Misty's browser tools do the
browsing, so the score measures the engine's model with Misty's harness. Always report both.

## Setup

1. Check out the benchmark beside this repository and Misty and install it, as its README says:

   ```bash
   git clone --branch v2.1.1 --single-branch https://github.com/browser-use/benchmark.git
   ```

   ```bash
   cd benchmark && uv sync --frozen --python 3.12 && cp .env.example .env
   ```

   Set `OPENAI_API_KEY` in `benchmark/.env`. The judge (`gpt-5.6-luna`, xhigh) needs it.
   `BROWSER_USE_API_KEY` isn't needed: no Browser Use service is used.

2. Start Misty's debug app (from `misty/`) with the eval bridge on. The token is any random string of at least 24
   characters; the bridge isn't compiled into release builds.

   ```bash
   export MISTY_BROWSER_EVAL_BRIDGE_TOKEN=$(openssl rand -hex 24)
   ```

   ```bash
   MISTY_BROWSER_EVAL_BRIDGE_PORT=47123 npm run tauri dev
   ```

3. In the app, use an account kept for benchmarking: runs browse with that profile's sign-ins,
   and the chats they leave contain the decrypted tasks. Send the agent you'll benchmark (for
   example the Claude Code agent) one message, so it has a folder. Deliverables are saved in
   `<agent folder>/bu-bench/<run>/` during a task, then copied out and deleted.

## Running

From `misty-browser-harness/`, in the same shell (so the token is set). The Misty checkout is
found beside it; pass `--misty <path>` otherwise.

```bash
uv run --project ../benchmark python benchmarks/bu-bench/misty_eval.py --bench ../benchmark --check
```

```bash
uv run --project ../benchmark python benchmarks/bu-bench/misty_eval.py --bench ../benchmark --tasks 5
```

Adjust `../benchmark` if you cloned it somewhere else. Options:

| Option | Default | |
| --- | --- | --- |
| `--engine` | `claude` | Runs as that engine's agent (`personal_engine_<engine>`) |
| `--agent` | | A specific agent id instead |
| `--model`, `--effort` | the agent's | The engine's model and reasoning effort |
| `--permission-mode` | `bypass` | The engine's mode; nobody is there to approve steps |
| `--tasks`, `--task-ids` | all 200 | Same as `run_eval.py` |
| `--shard-index`, `--shard-count` | | Same as `run_eval.py` |
| `--task-timeout` | 3600 | Seconds per task |
| `--parallel` | 1 | Runs at once in the app |
| `--judge-model`, `--judge-reasoning` | the benchmark's | Change only to match another run |

Results go to `benchmark/run_data/BU_Bench_V2_misty_<time>/`, in the layout `run_eval.py` uses:
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
  That last part is only an instruction; check `events.jsonl` if a score looks too good.
- **Cost** is what the engine reports (Claude Code reports it; others may report nothing).
- **Fresh browser per task:** BrowserCode starts a clean browser per task. Misty's runs share the
  profile's cookies, so sign-ins and site state carry between tasks.

Only compare scores on the same task set and revision, with the judge settings in `config.json`.
