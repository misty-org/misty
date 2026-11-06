# Smoke test

Runs a real agent through the real desktop app, end to end: the sign-in screens, the model settings, a
run claimed and finished by the runtime in the app, its shell and tools, a restart in the middle of a
run, and a cancel. The model is a scripted local server and the server is a throwaway one, so it needs
no model key and touches nothing of yours. It takes about three minutes after the app is built.

It runs on macOS, with a debug build, because it drives the app through the debug-only eval bridge
(`src-tauri/src/infra/browser/eval_bridge/`). It uses ports 47123, 5199, 18098, 18099 and 55439.

```bash
SCRATCH="$(mktemp -d)/smoke"
evals/smoke/stack.sh up "$SCRATCH/stack" &   # Postgres in Docker and the server from ../misty-server
# Wait for "Throwaway server on http://127.0.0.1:18099"
MISTY_SMOKE_DIR="$SCRATCH" MISTY_SMOKE_SERVER=http://127.0.0.1:18099 node evals/smoke/smoke.mjs
kill %1
evals/smoke/stack.sh down "$SCRATCH"
```

The app's data stays in `$SCRATCH/data`, the app's output in `$SCRATCH/app.log`, and the results in
`$SCRATCH/report-rust.json`. A step can be run alone with `--only agent,cancel` once the account is
signed in, and the first steps need an empty server: `signin` registers its first account.

## Comparing runtimes

`--runtime typescript` runs the app on the benchmark baseline
([runtime.md](../../docs/agents/runtime.md)), so build it first with `npm run build` in
`src-tauri/services/agent-runtime`. Run `--only agent,memory` on each, then compare what the model
received, with IDs and dates taken out:

```bash
node evals/smoke/parity.mjs "$SCRATCH/requests-typescript.json" "$SCRATCH/requests-rust.json"
```

## The files

| File | What it is |
| --- | --- |
| `smoke.mjs` | Starts the mock and the app, runs the steps, writes the report |
| `steps.mjs` | Permissions, sign-in, models, the agent's tools, shared folders |
| `steps-run.mjs` | Restart, cancel, modes, voice, memory |
| `run.mjs` | Sending a message from the app's store, and reading what the mock received |
| `bridge.mjs`, `window-helpers.js` | JavaScript in a person's window, through the bridge's `/window-eval` |
| `mock-model.mjs` | The scripted OpenAI-compatible model |
| `parity.mjs` | The diff between two runtimes' requests |
| `stack.sh` | The throwaway Postgres and server |

`web_fetch` only reads public addresses, so its success check reads `https://example.com/` and needs
the internet. Speech, transcription and Soniox have fixed addresses the mock can't stand in for, so
voice stops at the point it would need them. Editing a file in the repository while the app runs makes
Vite reload its window, which ends any script waiting in it.
