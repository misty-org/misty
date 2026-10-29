# Bring your own keys

Every model call in Misty runs on a key you supply. Misty has no keys of its own, no house model
and no billing: you choose the provider and the model, and your provider bills you directly.

## On a device

Settings → Models holds one key per provider and the model for each job:

| Choice | Used for | When empty |
| --- | --- | --- |
| Agent model | Thinking and seeing: agent runs, the companion, page reading | AI is off on this device, unless the server has its own models |
| Fast model | Routing, dictation cleanup, voice notes, day summaries | The agent model |
| Embedding model | Memory and Library search | Search falls back to text matching |
| Transcription, speech | Voice | Voice is off |
| Reasoning effort | How hard the agent model thinks | `low` |

Model IDs are `<provider>/<model as the provider names it>`, for example
`anthropic/claude-sonnet-5-5`, `openai/gpt-5.2`, `openrouter/anthropic/claude-sonnet-5.5` or
`ollama/qwen3:14b`. Keys for several providers can be saved at once, so the agent can run on one
provider and embeddings on another.

| Provider | ID | Notes |
| --- | --- | --- |
| OpenAI | `openai` | Chat, embeddings, transcription, speech |
| Anthropic | `anthropic` | Chat |
| Google Gemini | `google` | Chat |
| OpenRouter | `openrouter` | Any model OpenRouter lists |
| Vercel AI Gateway | `gateway` | Your own Gateway key |
| NVIDIA | `nvidia` | build.nvidia.com hosted models |
| Ollama | `ollama` | Base URL defaults to `http://host.docker.internal:11434/v1`, as the server's containers see your computer |
| OpenAI-compatible | `openai-compatible` | Any endpoint that speaks the OpenAI chat API; base URL required |
| ElevenLabs | `elevenlabs` | Speech |
| Soniox | `soniox` | Transcription |

Settings belong to the device and never sync, so each device has its own keys.

## How a key travels

Keys live in the operating system's keychain, read only by the app's native layer; the web layer
never sees them. The native layer adds one header, `X-Misty-Models`, to the requests it sends to
your server: the providers you have keys for, the model for each job and the reasoning effort.

Your server keeps the latest copy for your account in memory for up to 24 hours, so agent runs and
background work (Library indexing, scheduled runs) can call the model after the request that
started them has finished. It never writes keys to its database or logs. When the server restarts,
it has no key until your device's next request; a run that needs a model in that window stops
with "Add a model key in Settings → Models".

The agent runtime receives the key only inside the call that uses it. It never stores a key in an
agent run's history, its logs or its errors.

## Server keys

A server can also have models of its own, for a single-person install or for every account on a
shared one. Set `MISTY_AGENT_MODEL` (a model ID as above) and the matching provider key in the
server's environment:

| Provider | Variables |
| --- | --- |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`) |
| OpenRouter | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| NVIDIA | `NVIDIA_API_KEY` |
| Ollama | `OLLAMA_BASE_URL`, optionally `OLLAMA_API_KEY` |
| OpenAI-compatible | `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` |
| ElevenLabs, Soniox | `ELEVENLABS_API_KEY`, `SONIOX_API_KEY` |

On the server, an `openai/`, `anthropic/` or `google/` model with no key of its own goes through
`AI_GATEWAY_API_KEY` when that is set. A device's own keys always win, and never fall back to the
server's. The server's models are used only for an account whose devices
send none, and Settings → Models says when the server provides them. Anyone with an account on the
server can then spend on those keys, so turn off open sign-up on a shared server you pay for.

## Custom endpoints

Ollama and OpenAI-compatible base URLs are called from your server, not from your device. A base
URL on your local network works when the server can reach it, and `host.docker.internal` reaches
the server's own host. The runtime refuses loopback, link-local and single-label hosts (such as the
server's own containers), `.internal`, `.local` and `.localhost` names, and URLs with a user and
password in them. Other private addresses are allowed, so on a server other people use, any
account can make it call machines on its network; run such a server only for people you trust.
