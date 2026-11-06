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
4. Rust passes the delivery to the runtime on this computer (`agent_runtime_deliver`), and
   the worker reports what happened (`…/deliveries/{id}/finish`).
   - Cancels, reconciles and device resumes travel the same way.
   - The server's checks and bookkeeping are in `agent_runtime_delivery.go`. Its delivery
     worker only expires interventions, queues device resumes and reconciles stale runs; it
     never claims a delivery itself.
   - The runtime's control calls are signed with the run's key only. The server secret
     (`MISTY_AGENT_RUNTIME_CONTROL_SECRET`) never leaves the server.

## The helper process

`src-tauri/src/infra/agent_runtime/` starts the nitro build of `src-tauri/services/agent-runtime`
under Node on `127.0.0.1`, on a free port:

- **Launch secret:** a fresh secret for each launch signs every `/v1` call, so nothing else
  on the computer can drive the runtime.
- **Storage:** runs are kept by Workflow's local world in `~/.misty/runtime/world`, so a run
  continues after Misty quits and opens again. The log is `~/.misty/runtime/runtime.log`.
- **Desktop mode:** set with `MISTY_RUNTIME_DESKTOP=1`. The app gives the runtime this
  device's model document on `POST /v1/local/models`, again whenever a key or model choice
  changes. It's held on the process global, because Workflow bundles steps apart from
  routes. It can carry a short-lived ChatGPT access token (the `chatgpt` provider,
  [byok.md](../byok.md)); Rust refreshes it and pushes a new document before it expires.
- **The run's model:** the run reports the device's models in its `context` request, and
  the server sizes and records the run by them.
- **Development:** uses the checkout's `.output`, so run `npm run build` in
  `src-tauri/services/agent-runtime` first, and the system `node`.
- **Release builds** (`cli/src/release/runtime.rs`):
  - ship `.output` as the `agent-runtime` resource and the Node named by
    `MISTY_RELEASE_NODE` as the `misty-node` sidecar;
  - macOS needs a universal Node, and the app has `allow-jit` for it.

## Model calls outside runs

The renderer calls `deviceModelCall` (`src/api/device-models.ts`). That goes to Rust
`agent_runtime_call`, then to the runtime's `/v1/device/*` (`src/device-calls.ts`):

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
- **Live transcription:** Rust mints the relay's one-time ticket with the launch secret
  (`agent_runtime_live_ticket`). The relay streams to Soniox on the device's key.
- **The companion's spoken conversation:** it opens at `/v1/device/voice` with a one-time voice
  ticket (`agent_runtime_voice_ticket`); `src/voice/session.ts` holds the session.
  - It speaks the protocol of `companionConversation.ts`. Each turn is transcribed on the
    transcription model, answered on the fast model, which may call `start_task`,
    `steer_task`, `cancel_task` or `get_task_status`, and spoken sentence by sentence on the
    speech model.
  - The app does the tools' work, and sends the chat's last turns and its task when the socket
    opens. The voice answers `get_context` from that itself.
- **Older turns:** a run's `context` carries `summary_request` when a long chat's older turns
  have aged out of the window. The runtime writes the notes on the fast model as the run ends.
  The server recomputes which turns those were before saving the notes
  (`device_summaries.go`).

## Reading a page

`web.fetch` runs in the runtime too (`src-tauri/services/agent-runtime/src/web-fetch/`), on every run, with no key. A run is always on the computer that started it, so the server never fetches a page itself; what the fetch returned is stored with the conversation ([README.md](README.md#where-conversations-live)). Every address and redirect must resolve only to public addresses, checked as it connects, so an untrusted page can't send the agent into the person's own network.

## Web search

`web.search` runs in the runtime itself (`src-tauri/services/agent-runtime/src/web-search/`), on the
search service and key the person keeps in Settings › Models ([byok.md](../byok.md#web-search)).
It has the same name, input, output and description as when the server ran it, and never goes
through the server's MCP gateway.

- **The key:** Rust adds `search: {provider, apiKey}` to the model document on
  `/v1/local/models` when the chosen service (`decodo` or `serper`) has a saved key.
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
  on a development server.
