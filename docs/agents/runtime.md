# The agent runtime runs on your computer

Agents run on the computer that sent them, and every model call and web search happens there.
The device uses its own models and keys, and the server never calls a model, searches the web or
receives a key. Agents
need that computer to be on. This was built on October 31, 2026, as phase 1 of the Misty
Cloud plan, and the server's last model path went the same day. Model sign-ins live in
[byok.md](../byok.md).

## How a run starts

1. The app sends a message as before (`POST /ai/invocations`). The server admits it and
   queues an `invocation.start` delivery (`agent_runtime_deliveries`).
2. The desktop's delivery worker (`src/features/agents/runtimeDeliveries.ts`) holds a claim
   open: `POST /devices/{id}/agent-runtime/deliveries/claim`, signed with the device key,
   held up to 25 s and woken on the `runtime` account topic.
   - A delivery goes to the computer the run is pinned to (`runtime_endpoint 'device:<id>'`), which
     admission sets to the computer it was sent from.
   - A run sent from no computer (a schedule with no computer) goes to the first of the person's
     computers that claims it.
3. The server runs its usual checks and pins a start to the claiming device. It hands over
   the run's key: `HMAC-SHA256(server secret, "misty-run-key" || 0 || runID)`. The key opens
   that run's `/internal/agent-runtime/runs/{runID}/…` calls and nothing else, and the server
   derives it again rather than storing it.
4. Rust passes the delivery to the runtime in this app (`agent_runtime_deliver`), and
   the worker reports what happened (`…/deliveries/{id}/finish`).
   - Cancels, reconciles and device resumes travel the same way.
   - The server's checks and bookkeeping are in `agent_runtime_delivery.go`. Its delivery
     worker only expires interventions, queues device resumes and reconciles stale runs; it
     never claims a delivery itself.
   - The runtime's control calls are signed with the run's key only. The server secret
     (`MISTY_AGENT_RUNTIME_CONTROL_SECRET`) never leaves the server.

## The runtime in the app

Agents run on the `misty-agent` crate (`src-tauri/crates/agent`) inside the Misty process, and
`src-tauri/src/infra/agent_runtime/` holds the one `AgentRuntime`. No release ships Node, a local
server or request signing.

- **Starting:** on the first delivery or model call, or as Misty opens when runs are left on disk.
  It gets this device's models before it resumes anything, or a resumed run would fail with
  `model_key_needed`. A model document that couldn't be read stops it starting and is tried again,
  so a passing failure can't look like a person with no keys. With no runs waiting, someone who only
  browses never reaches the keychain for model keys.
- **Storage:** runs are kept in `~/.misty/runtime/runs`, so a run continues after Misty quits and
  opens again. Runs the Node runtime had under `~/.misty/runtime/world` aren't carried over.
- **The log:** `[misty-agent-runtime]` lines go to `~/.misty/runtime/runtime.log`, which benchmarks
  read. Past 20 MiB it moves to `runtime.log.1`, over any older one. Keys are scrubbed where errors are
  made, and what a panic says isn't logged.
- **The models:** the app gives the runtime this device's model document as it starts and again
  whenever a key or model choice changes (`models_changed`). It can carry a short-lived ChatGPT
  access token (the `chatgpt` provider, [byok.md](../byok.md)); Rust refreshes it and gives the runtime
  a new document before it expires.
- **The run's model:** the run reports the device's models in its `context` request, and
  the server sizes and records the run by them.
- **Failures stay small:** each run is its own task, and so is each device call and voice session, so
  a panic fails that one alone. That needs panics to unwind, so a build with `panic=abort` doesn't
  compile (`agent_runtime/mod.rs`). A device call past 10 minutes answers as one that failed.
- **Connections:** IPv4 first, no proxy, 10 s to connect, as Node's `fetch` behaved.

### The TypeScript runtime, for benchmarks only

`src-tauri/services/agent-runtime` stays until the crate scores the same or better
([the plan](../plans/app-permissions.md#how-it-gets-done)). In a debug build,
`MISTY_AGENT_RUNTIME=typescript` starts it under the system's Node from the checkout's `.output`, on
the old signed local path, so run `npm run build` there first. That path is one folder marked for
deletion, `infra/agent_runtime/typescript_baseline/`. It isn't compiled into a release, and voice and
live transcription aren't available on it. The Odysseys runner checks through the debug bridge that the
app really is on the runtime the report names.

## Model calls outside runs

The renderer calls `deviceModelCall` (`src/api/device-models.ts`). That goes to Rust
`agent_runtime_call`, then to the crate's `DeviceCalls` (`runtime/device/`). The body goes as text,
because a parsed value would sort its keys and a schema has to reach the model as it was written.
Failures keep the statuses and codes the TypeScript routes answered with:

| Call | Role | Notes |
| --- | --- | --- |
| `cleanup` | fast | Dictation cleanup |
| `voice-transcription` | transcription | A spoken request to an agent |
| `screen-model` | agent | The `browser.act` planner. Capped at 80 calls per job on the device |
| `refine-point` | agent | Companion pointing. 4 refinements per answer, within 10 minutes |
| `extract` | agent | `browser.extract` extracts as its device job ends; the server still checks links against the page |
| `embed` | embedding | 768 dimensions |
| `day-summary` | fast | The server sends the day's items |
| `voice-notes` | agent | The server sends the transcript, then saves the Note |
| `transcribe-diarized` | Soniox `stt-async-v4` | Needs a Soniox key on the device |
| `model-test` | agent | Settings › Models checks that the agent model calls tools and sees screenshots |
| `follow-up` | fast | Whether a message to an agent with an active task steers it, queues after it, or stops it (`src/device-routing.ts`) |
| `restore-step` | fast | The next action of a page-state restore after a device switch, checked against the page's own controls |

- **Titles:** a run's `context` carries `title_prompt` while its chat still has its
  placeholder. As the run ends, the runtime names the chat on the fast model and sends the
  title with `complete`.
- **Embeddings for search and memory:** the desktop's `DeviceEmbeddingWorker` claims its
  owner's chunks that wait for a vector (`/devices/{id}/embeddings/claim|complete`). The
  server has no embedding worker.
- **Query vectors:**
  - An agent's `memory.history.search` and `memory.pref.list` carry their query's vector in
    the tool call's `_meta` (`misty/query_embedding`).
  - Recall's search box sends it in `X-Misty-Query-Embedding`.
  - Without a vector, a search finds nothing by meaning; the server never embeds a query.
- **Sessions:** voice and live transcription are long conversations between the renderer and the
  crate, in the same messages and order the WebSockets carried. A Tauri channel carries what the
  runtime says, and `agent_runtime_session_send` carries what the renderer says, numbered, because
  IPC calls don't promise to arrive in order (`infra/agent_runtime/sessions.rs`,
  `src/api/runtimeSocket.ts`). There are no tickets or local sockets.
  - Only a person's own window can open a session: both the action set (`action-voice`, which an
    incognito window doesn't have) and the command check it. Only the window that opened one can use it.
  - A window that reloads or closes ends its sessions, so nothing keeps streaming on the person's key.
- **Live transcription:** `agent_runtime_live_open` streams to Soniox on the device's key
  (`runtime/live/`). A session with no usable key is refused as it opens.
- **The companion's spoken conversation:** `agent_runtime_voice_open` (`runtime/voice/`).
  - It speaks the protocol of `companionConversation.ts`. Each turn is transcribed on the
    transcription model, answered on the fast model, which may call `start_task`,
    `steer_task`, `cancel_task` or `get_task_status`, and spoken sentence by sentence on the
    speech model.
  - The app does the tools' work, and sends the chat's last turns and its task when the session
    opens. The voice answers `get_context` from that itself.
- **Older turns:** a run's `context` carries `summary_request` when a long chat's older turns
  have aged out of the window. The runtime writes the notes on the fast model as the run ends.
  The server recomputes which turns those were before saving the notes
  (`device_summaries.go`).

## Reading a page

`web.fetch` runs in the runtime too (`runtime/web_fetch/`), on every run, with no key. A run is always on the computer that started it, so the server never fetches a page itself; what the fetch returned is stored with the conversation ([README.md](README.md#where-conversations-live)). Every address and redirect must resolve only to public addresses, checked as it connects, so an untrusted page can't send the agent into the person's own network.

The page itself is read by a worker the OS confines (`src-tauri/services/page-reader`, `src-tauri/src/infra/page_reader/`), with no network and no files: `sandbox/permissions/page-reader.sb` on macOS, an AppContainer on Windows. It takes the page on standard input and answers on standard output, within 8 MiB in, 16 MiB out and 20 seconds, and runs the same code the in-process function does (`src-tauri/crates/page-reader`). If it fails, that fetch fails with `page_read_failed`, and nothing reads the page in Misty's own process. On macOS one copy of the worker stays staged for the app's lifetime, because a fresh copy cost about 160 ms per read and a kept one about 9 ms, and it's checked against the bytes in the signed app before each use.

## Web search

`web.search` runs in the runtime itself (`runtime/web_search/`), on the
search service and key the person keeps in Settings › Models ([byok.md](../byok.md#web-search)).
It has the same name, input, output and description as when the server ran it, and never goes
through the server's MCP gateway.

- **The key:** Rust adds `search: {provider, apiKey}` to the model document when the chosen service
  (`decodo` or `serper`) has a saved key.
- **Offering it:** the `context` step reads the device's search service and sends
  `device_tools: ["web.search"]`, so the server's prompt describes `web_search` for the run
  (`agent_runtime_device.go`); `assembleTools` adds the descriptor to the catalog
  (`withDeviceTools`), with only the kinds that service offers. Without a key the tool is left
  out and the prompt doesn't name it. A Teach-mode lesson offers `web_search` the same way.
- **Running it:** `executeCapability` sends the call to the `deviceWebSearch` step instead of
  the gateway. Decodo is one `POST https://data.decodo.com/v1/scrape` (`google_search`, with
  `google_tbm` for news, videos and images); Serper is one `POST https://google.serper.dev/<tab>`
  per kind. Answers are kept in memory for 6 hours, so a repeat costs nothing. Results stay
  marked untrusted, and a failure is a coded tool error the model plans around.
- **The timeline:** the runtime announces the call itself, and its finished checkpoint carries
  the query and the links found (`device_arguments`, `device_result`), which the server turns
  into the conversation's activity line.

## What the server keeps

- **Conversations:** turns, replies, the timeline and tool output, for their owner
  ([README.md](README.md#where-conversations-live)). Each run's earlier turns come from there.
- **No model path and no search:** the server has no model client, no operator model or key,
  no search key or provider, and no voice routes. `/agent-voice/*`, `/me/voice/live/ticket`, `/internal/voice/live/credential`,
  `/ai/me/voice/cleanup`, `/ai/models`, `/me/screen-model/*`, `/me/companion/refine-point/*`,
  `/misty/agent-followup` and `/sync/restore/step` are gone, and so are the server-side
  `voice.transcribe` and `voice.to_notes` tools.
- **Device answers only:** day summaries, voice Notes and file transcription answer
  `on_device` with what the desktop needs, then save what it sends back. A `browser.extract`
  job that comes back without `data` is a tool error.
- **Production refuses stale settings:** a model key, `MISTY_AGENT_MODEL` or
  `MISTY_AGENT_RUNTIME_URL` in a production environment stops the server at startup.
- **No X-Misty-Models:** no server receives an account's keys. An older app's header is
  dropped on arrival.
- **Evals:** the Odysseys runner (`evals/odysseys/`, [evals/odysseys.md](evals/odysseys.md)) drives
  the desktop through the product path. The server's only part is `eval_turn_limit`, honored only
  on a development server. `evals/smoke/` runs one agent through the real app on a scripted local
  model and a throwaway server, with no key.
