# Misty Agent Operations

The AI service is exposed through authenticated `/ai` and `/api/ai` routes. Sessions are in-memory through `agent.SessionStore`; restarting the server drops active sessions and events.

## Provider Selection

`agent.NewProviderFromEnv` chooses the provider in this order:

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

## Environment

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

Provider errors are recorded as `error` events in the session rather than returned as HTTP 500 from the message endpoint. This keeps the client session recoverable and lets the frontend display model failures as agent events.

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
