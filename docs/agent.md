# Misty Agent Operations

The AI service is exposed through authenticated `/ai` and `/api/ai` routes. Sessions are in-memory through `agent.SessionStore`; restarting the server drops active sessions and events.

## Mika Model Routing

Clients only see the Misty-owned Mika model names. The server maps the user's
effective subscription to a route and keeps the concrete provider/model private:

- Basic and legacy tiers: `mika-low` (`Mika Low`)
- Pro and Pro trials: `mika-med` (`Mika Med`)
- Max: `mika-high` (`Mika High`)

The client cannot request or override a Mika tier. Message and tool-result calls
re-evaluate the current license so subscription changes take effect on active
sessions. Provider/model names remain in server-only credit usage records for
cost reconciliation, but are not returned by AI status or event endpoints.

Production Mika requests use Vercel AI Gateway's OpenAI-compatible Responses API.
The only required secret for an externally hosted server is:

```bash
AI_GATEWAY_API_KEY=...
```

When the server itself runs on Vercel, `VERCEL_OIDC_TOKEN` is accepted as a
fallback. A configured API key always takes precedence. The optional routing
variables and their defaults are:

```bash
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
MISTY_AI_LOW_MODEL=google/gemini-2.5-flash-lite
MISTY_AI_MED_MODEL=google/gemini-2.5-flash
MISTY_AI_HIGH_MODEL=google/gemini-3.5-flash
```

The model values use Vercel's `creator/model` IDs. If gateway authentication is
missing, all Mika routes use the mock provider and `/ai/status` reports
`configured: false`; the server never silently falls back to a direct provider.

Vercel's free credits are suitable for development smoke tests, but individual
models can return HTTP 429 on the free tier. Fund gateway credits before treating
all three Mika routes as production-ready.

## Legacy Direct Providers

The lower-level direct-provider factory remains available for local tests and
compatibility, but `CreateServer` does not use it for Mika traffic. It chooses:

1. `MISTY_AI_PROVIDER`, when set.
2. OpenAI when `OPENAI_API_KEY` is present.
3. Gemini when `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or ADC auth is configured.
4. Mock provider.

Supported `MISTY_AI_PROVIDER` values:

- `openai`
- `gemini`
- `gemini_rest`
- `mock`

If a requested provider lacks required credentials, the service falls back to the mock provider instead of failing server startup.

## Legacy Direct-Provider Environment

OpenAI:

```bash
MISTY_AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
MISTY_AI_MODEL=...
```

Gemini ADK:

```bash
MISTY_AI_PROVIDER=gemini
GEMINI_AUTH_MODE=auto
GEMINI_API_KEY=...
GEMINI_VERTEX_PROJECT=...
GEMINI_VERTEX_LOCATION=...
MISTY_AI_MODEL=...
```

Gemini REST:

```bash
MISTY_AI_PROVIDER=gemini_rest
GEMINI_AUTH_MODE=api_key
GEMINI_API_KEY=...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_OAUTH_SCOPE=https://www.googleapis.com/auth/generative-language
MISTY_AI_MODEL=...
```

`GEMINI_AUTH_MODE` accepts `auto`, `api_key`, or `adc`. ADC mode uses Google Application Default Credentials.

## Runtime Contract

The frontend creates a session, sends user messages, executes requested tools, submits tool results, and polls events.

Provider responses are expected to parse into `agent.ModelResponse`:

- `text`: assistant text to append and emit.
- `tool_requests`: requested tools with risk and arguments.
- `file_plan`: proposed file operations.

Provider errors are logged internally and recorded as provider-neutral Mika
errors in the session rather than returned as HTTP 500 from the message endpoint.
This keeps the client session recoverable without exposing routing details.

## Cancellation

Vercel gateway requests use request-scoped contexts. The session cancel endpoint
cancels the active HTTP request, releases its credit reservation, marks the
session canceled, and does not retry it. Client disconnects also cancel the
request context.

## Abuse And Cost Controls

- All AI endpoints require a valid Misty session cookie or bearer token. Gateway
  credentials and concrete model IDs remain server-only.
- Provider-producing calls share a per-user budget of 12 calls per minute and
  120 calls per hour, with only one in-flight call per user. Rejected calls are
  not queued or retried.
- A second server-wide circuit limits gateway traffic to 60 calls per minute,
  1,000 per hour, and eight concurrent calls across all users.
- Session creation is limited to 20 per user per hour. The outer IP limiter also
  normalizes dynamic session IDs so new IDs cannot bypass route limits.
- One user message can cause at most three provider calls, including tool-result
  continuations. A new user message is required after that boundary.
- Tool results must match an outstanding request ID and tool name exactly, may
  be submitted only once, and are bounded by count and byte size.
- User prompts are limited to 32 KiB. Tool result payloads are limited to 512 KiB.
- The server and desktop do not automatically retry failed, expired, canceled,
  rate-limited, or gateway-error requests. Auto mode may continue explicitly
  requested safe tool steps within the three-call turn cap.
- AI HTTP clients reject redirects, including 307/308 responses, so redirects
  cannot cause a prompt POST or bearer credential to be resent elsewhere.

## Modes And Permissions

Message mode is normalized to:

- `ask`
- `auto`
- `full`

Tool requests are passed through `PermissionPolicy.Apply`, which marks approvals based on mode and tool risk. File plans are validated before emission. Unsafe paths are rejected when they are absolute, contain parent traversal, contain drive-style separators, begin with dot segments, or target blocked system folder names.

## Robustness Notes

- Default provider HTTP clients use a 45 second timeout.
- OpenAI and Gemini response bodies are capped at 4 MiB while reading provider responses.
- AI request bodies are capped at 2 MiB.
- Known paths are collected from selected paths and successful tool results so file-plan validation can catch accidental overwrites.
- Session ownership is enforced by user ID on all session reads and writes.
- Credits are reserved before provider calls and settled from provider-reported
  input, cached-input, output, and reasoning usage. The internal provider/model
  selects the server-owned rate card; public Mika aliases are never used for
  provider billing calculations.
- Mika usage is billed with granular micro-credits rather than a flat charge per
  conversation. Fresh input, cached input, and output tokens use the internal
  route's provider rate, converted at one credit per millionth of a dollar with
  a 15% operating buffer. Monthly grants are 100,000 credits for Basic,
  2,000,000 for Pro, and 6,000,000 for Max. Packs grant 1,500,000 or 3,500,000
  credits. Existing balances migrate at 1 old credit to 1,000 micro-credits.
- `MISTY_RUN_LIVE_AI_TEST=1 go test ./agent -run TestMikaGatewayLiveAgentCapabilities -v`
  spends a small amount of gateway credit and verifies structured output, usage,
  tool requests, tool results, file-plan generation, and all configured Mika tiers.
  Free-tier rate limits are reported as skipped tier checks rather than schema failures.
