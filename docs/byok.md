# Models on your device

Every model call in Misty runs on this computer, on a model account you bring. Agents run in the
agent runtime the app starts beside itself ([agents/runtime.md](agents/runtime.md)),
and the server never calls a model or holds a model key. Misty has no keys of its own, no house
model and no billing for AI: you choose the provider and the model, and your provider bills you,
or your ChatGPT plan covers it.

## Settings › Models

The page, and the last step of the setup wizard, offer three ways in. The wizard reaches this
step after signing in:

- **Sign in with ChatGPT** uses your ChatGPT plan instead of a key (below).
- **Sign in with OpenRouter** has OpenRouter make a key for Misty and saves it.
- **Paste a key** from any provider. Misty finds the provider from the key's prefix and confirms
  it by listing that provider's models with it, then offers those models to pick from.

| Choice | Used for | When empty |
| --- | --- | --- |
| Agent model | Thinking and seeing: agent runs, the companion, page reading | AI is off on this device |
| Fast model | Routing, dictation cleanup, voice notes, day summaries | The agent model |
| Embedding model | Memory and Library search by meaning | Agents can't search memory; search you type still matches words |
| Transcription, speech | Voice | Voice is off |
| Reasoning effort | How hard the agent model thinks | `low` |

**Check the agent model** asks the chosen model to call a tool and to read a screenshot a tool
returned, the two things every agent run needs, and says which one works. It runs on the device's
runtime (`/v1/device/model-test`, with the checks in
`src-tauri/services/agent-runtime/src/model-checks.ts`).

Model IDs are `<provider>/<model as the provider names it>`, for example
`anthropic/claude-sonnet-5-5`, `chatgpt/gpt-6.1-sol`, `openrouter/anthropic/claude-sonnet-5.5`,
`ollama-cloud/gpt-oss:120b` or `ollama/qwen3:14b`. Several providers can be set up at once, so the
agent can run on one and embeddings on another.

| Provider | ID | How | Notes |
| --- | --- | --- | --- |
| ChatGPT | `chatgpt` | Sign in | Your ChatGPT plan's usage; language models only, no embeddings or voice |
| OpenAI | `openai` | `sk-proj-…`, `sk-…` | Chat, embeddings, transcription, speech |
| Anthropic | `anthropic` | `sk-ant-…` | Chat |
| Google Gemini | `google` | `AIza…` | Chat, embeddings |
| OpenRouter | `openrouter` | Sign in, or `sk-or-…` | Any model OpenRouter lists |
| Vercel AI Gateway | `gateway` | `vck_…` | Your own Gateway key |
| NVIDIA | `nvidia` | `nvapi-…` | build.nvidia.com hosted models |
| Ollama Cloud | `ollama-cloud` | A key from ollama.com/settings/keys | Calls `https://ollama.com/v1` |
| Ollama | `ollama` | No key | Your own Ollama; the base URL defaults to `http://127.0.0.1:11434/v1` |
| OpenAI-compatible | `openai-compatible` | Optional key | Any endpoint that speaks the OpenAI chat API; base URL required |
| ElevenLabs | `elevenlabs` | Voice section | Speech |
| Soniox | `soniox` | Voice section | Transcription |

A key with no known prefix is tried as an Ollama Cloud key. Settings belong to the device and
never sync, so each device has its own keys and sign-ins.

## Web search

Agents search the web from this computer too, on a search key you bring: the **Web search**
section of Settings › Models picks the service (a checkmarked dropdown) and saves its key.

| Service | Key | Kinds |
| --- | --- | --- |
| Decodo (default) | The Web Scraping API key from the Decodo dashboard | Web, news, videos, images |
| Serper | An API key from serper.dev | Web, news, videos, images, places, shopping, scholar, patents, maps, autocomplete |

The key is kept and handed over exactly like a model key (below), under the service's ID
(`decodo` or `serper`), and the choice is the device setting `models.search_provider`. The runtime
runs `web.search` itself and calls the service straight from this computer
([agents/runtime.md](agents/runtime.md#web-search)). Without a key, agents aren't offered web
search and their prompt doesn't mention it; they still read pages with `web.fetch`. Your search
service bills you; no Misty server counts or limits searches.

## How a key travels

Keys and sign-ins live in Misty's credential store (sealed rows in `misty.db` whose master key
is in the OS keychain), read only by the app's native layer (`src-tauri/src/infra/models/`).
The web layer sees a key only while you paste it, and can never read one back.

The native layer gives the runtime on this computer a model document over its signed local
route (`POST /v1/local/models`): the providers you set up, the model for each role, the
reasoning effort and the web search service with its key (`search`). The runtime keeps it in
memory and sends each key only to its provider. Base
URLs are called from this computer, so a model server on it or on your network works.

No key, search key or model choice ever goes to a Misty server.

## Sign in with ChatGPT

This is OpenAI's ChatGPT plan usage for open-source and locally hosted apps
(developers.openai.com/siwc/token-sharing-open-source), in preview.

- **Signing in** opens your browser at `auth.openai.com` with PKCE, a loopback callback on
  `http://127.0.0.1:<port>/auth/callback`, and this computer's host ID (`urn:uuid:…`, made once
  and kept in the credential store). The callback waits 15 minutes, then closes; its page opens Misty again with a `misty://` link. The first
  sign-in registers a client through `dynamic_agent_client`; later ones reuse the client it
  issued. Scopes are
  `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, for the
  resource `https://api.openai.com/v1`.
- **The ID token** is checked for issuer, audience, expiry and nonce. It comes straight from the
  token endpoint over TLS, so its signature isn't (OpenID Connect Core 3.1.3.7).
- **Without the plan grant** (`chatgpt.tokens.use.direct`) Misty stays signed in but sends no
  requests, and Settings says to sign in again and allow it, or use a key.
- **Tokens** stay in the credential store (`com.misty.models.chatgpt`). Access tokens last an
  hour; Rust renews one with the rotating refresh token when five minutes are left, one renewal
  at a time, and gives the runtime the new token before the old one runs out. Only the access
  token reaches the runtime, and it never goes to the Misty server. A dead refresh token signs
  out and keeps the registration; a network failure keeps the tokens.
- **Requests** go to the Responses API with the access token as the bearer, `store: false` and
  `stream: true`. System text moves into `instructions`, and `max_output_tokens`, `temperature`,
  `top_p`, `previous_response_id` and the other fields the preview refuses are dropped
  (`src-tauri/services/agent-runtime/src/chatgpt-provider.ts`). A plan usage limit shows as a 429.
- **Signing out** revokes the refresh token at the issuer's revocation endpoint and clears the
  tokens. If OpenAI doesn't confirm it, Settings says so; you can disconnect Misty in ChatGPT's
  settings.

Paid or remotely hosted apps must use OpenAI's interest form instead, so Misty Pro may need
that before its customers sign in with ChatGPT. Misty never offers a Claude.ai login: Anthropic
forbids third-party apps from using Claude subscription sign-ins. Use an Anthropic API key.

## No server keys

A server never holds model keys and never calls a model; it has no model client at all. A
production server refuses to start when it finds a model key, `MISTY_AGENT_MODEL` or
`MISTY_AGENT_RUNTIME_URL` in its environment. The development stack has no agent runtime of
its own either: runs go to a desktop there too. Nor does a server hold a search key: web search
runs on each device's own key (above).

## Sign in with OpenRouter

OpenRouter's PKCE key flow (openrouter.ai/docs/use-cases/oauth-pkce): your browser opens
`openrouter.ai/auth` with a `http://localhost:<port>/callback` callback, you approve, and the
native layer exchanges the code at `/api/v1/auth/keys` for a key it saves like a pasted one.

## What the server pays for

Nothing model- or search-related. Every model call, the companion's spoken conversation
included, and every web search run on this device, on your own keys
([agents/runtime.md](agents/runtime.md)).
