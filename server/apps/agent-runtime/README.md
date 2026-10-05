# Misty Agent Runtime

Durable Misty execution built with AI SDK 7 `WorkflowAgent`. The runtime has no Misty database access. Run activation, context, checkpoints, device and user-action resumption, cancellation, and completion cross the signed Go control-plane API; application tools use Misty's authenticated MCP endpoint.

## Cloud-to-MCP flow

1. Go starts a Vercel Workflow run through the signed lifecycle API.
2. The workflow activates and reads its authoritative context.
3. At run start, Vercel exchanges its signed runtime identity for a five-minute bearer, discovers the run-scoped MCP catalog, and turns connected remote JSON Schemas into model-visible tools.
4. Immediately before each tool call, Vercel exchanges for a fresh bearer and the official TypeScript MCP client calls the Go SDK's stateless `POST /mcp` endpoint over the same HTTPS API base.
5. Go revalidates the active runtime binding, user, Space capabilities and device grants on every request, then executes through the canonical Agent Toolbox and audit journal.

Tokens cannot be reused for another Misty run or Vercel Workflow run. During a rolling deployment, the runtime falls back to the signed legacy tool endpoint only when token discovery is unavailable and before any tool execution begins.

## Tool calls

- The model sees every tool in the run's catalog under its Misty name, with dots as underscores (`notes.search` is `notes_search`). There is no discovery tool or working set; Go decides what the catalog contains.
- A call Misty rejected without effect, and any failed read, returns its error to the model, which corrects the call or picks another tool. Later calls from the same model response are reported as not attempted.
- A write whose outcome is unknown, a declined app confirmation, an unavailable device, a required sign-in, or a write repeated after the same rejection stops the run.
- The model reports the outcome with `misty_finish_task`. `misty_browser_act` runs Midscene against the assigned browser when the native adapter is available.
- `workflows/space-task-agent.ts` only orchestrates the run. Tool naming lives in `src/model-tools.ts`, call outcomes in `src/tool-outcomes.ts` and `src/tool-monitor.ts`, transport in `src/tool-calls.ts`, and lifecycle steps in `src/control-plane-steps.ts`.

## Worlds

- Local development: omit `WORKFLOW_TARGET_WORLD` to use Workflow's local world.
- Production: `compose.prod.yml` sets `WORKFLOW_TARGET_WORLD=@workflow/world-postgres` and points `WORKFLOW_POSTGRES_URL` at the `workflow` database on the shared Postgres server; its `agent-runtime-setup` job runs the world migrations before the worker starts.
- Vercel: use `apps/agent-runtime` as the project root and `npm run build` as the build command. Workflow selects the managed Vercel world in that environment.

A Vercel Workflow is the durable execution host for Misty's agent loop, not the
browser frontend and not the MCP server. In development, `misty server up` runs
the workflow runtime, its PostgreSQL world, the Go API, and the MCP endpoint in
local containers. Production runs the same containers on the VPS through
`compose.prod.yml`; deploying only this runtime to Vercel remains possible.

## Required environment

- `MISTY_INTERNAL_API_BASE`: HTTPS base for the Go API. A reverse-proxy prefix such as `/api` is preserved when resolving the signed internal routes and `/mcp` (private `http://api:8080` is allowed in Compose).
- `MISTY_AGENT_RUNTIME_CONTROL_SECRET`: base64-encoded secret of at least 32 bytes, shared with Go.
- `MISTY_AGENT_RUNTIME_CONTROL_SECRET_PREVIOUS`: optional previous secret during rotation.
- `AI_GATEWAY_API_KEY`: AI Gateway credential outside Vercel OIDC environments.

The Go API uses this workflow runtime for every assigned Space task. Configure its endpoint with `MISTY_AGENT_RUNTIME_URL`; there is no legacy/runtime mode switch. `misty server up` starts the local Postgres world, setup job, runtime, and Go API together.

## Vercel CLI deployment

Create one shared secret and keep it out of shell history:

```sh
openssl rand -base64 32
```

From `apps/agent-runtime/`, link the Vercel project, add the production variables,
and deploy. `MISTY_INTERNAL_API_BASE` is the externally reachable Go API base,
including any reverse-proxy prefix such as `/api`.

```sh
vercel link
vercel env add MISTY_INTERNAL_API_BASE production
vercel env add MISTY_AGENT_RUNTIME_CONTROL_SECRET production --sensitive
# Run these two only when rotation is active or AI Gateway requires a key:
vercel env add MISTY_AGENT_RUNTIME_CONTROL_SECRET_PREVIOUS production --sensitive
vercel env add AI_GATEWAY_API_KEY production --sensitive
vercel deploy --prod
```

The previous secret and AI Gateway key are optional when no rotation is active
or Vercel OIDC supplies the gateway identity. Configure the resulting HTTPS
deployment URL as `MISTY_AGENT_RUNTIME_URL` on Go. Do not assume a hostname such
as `agents.mistysys.com`; use the Vercel URL or a custom domain that you have
actually attached to the runtime project.

The signed Go start request also carries
`MISTY_AGENT_RUNTIME_INTERNAL_API_URL` for each run. The Vercel
`MISTY_INTERNAL_API_BASE` value is retained as a rolling-deployment fallback;
set both to the same reachable API base.

## Instance model

Instance models always route through the AI Gateway (`AI_GATEWAY_API_KEY` or
Vercel OIDC). `MISTY_AGENT_MODEL` optionally pins the default Gateway model;
configure the API and runtime consistently. Account connections (below) are
the only way to bring a provider key.

`InstanceModel` persists only public model/run/role identity at workflow boundaries
and resolves credentials inside model execution. Never replace it with a serialized
SDK model that contains resolved authorization headers.

## Account provider settings

Settings → Agents → Models manages account-owned OpenAI, Anthropic, Google,
Vercel Gateway and custom OpenAI-compatible connections. Provider secrets are
write-only, encrypted with the server's connection encryption key, and bound to
one user/connection/provider. They are separate from synchronized preferences.
Custom account endpoints must be public HTTPS; transports revalidate and pin DNS
on each connection, reject private/reserved addresses and do not follow redirects.
The AI Gateway remains the default for unassigned tasks.

Each supported task selects one connection/model/reasoning choice. The Models
page limits connections by the implemented protocol: all five providers for
SDK agent/vision calls; OpenAI and Gateway for follow-up routing and realtime;
OpenAI, Gateway and OpenAI-compatible for Library, embeddings, transcription and
speech. Realtime account connections use the server-owned WebSocket adapter.

The signed `model-provider` callback validates the active runtime binding and
its frozen role/model before resolving credentials inside the model step. No
credential response is cached or serialized into workflow history. Main agent
and visual planning turns are admitted and settled under their respective models.
There is no implicit model/provider fallback. Optional Library second passes
and transcription retries can be disabled or assigned explicitly.

“Use OpenAI defaults” selects GPT-6 Luna with low reasoning, Realtime 2.1 Mini,
text-embedding-3-small, gpt-4o-mini-transcribe and tts-1. It disables optional
second passes; users review and save choices before they apply. Text embeddings
index Library descriptions instead of raw images. Visual search needs a
multimodal embedding route. Search excludes vectors from a different embedding
model; switching models requires approved reindexing for existing files.

Apply migration `20271004030000_ai_provider_settings.sql` and deploy API/runtime
changes together before enabling the new settings UI.
