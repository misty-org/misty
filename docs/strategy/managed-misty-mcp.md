# Managed Misty and MCP architecture

## Product contract

Misty is the only user-facing assistant. The application does not expose model selection, custom instructions, run modes, or a roster of assistants. Misty may create bounded background workers, but their identities are implementation detail; the parent conversation remains the place where status, approvals, and results appear.

The Agents destination is therefore a Misty work log: one composer, durable conversations, active state, approvals, cancellation, failures, completed results, and tool connections.

Legacy custom-Agent creation, editing, model selection, direct invocation, direct conversations, and per-Agent MCP grants are not mounted API capabilities. Existing Agent records and runs remain readable only where needed to preserve historical work; internal worker provisioning is not exposed to the client.

## Runtime path

1. A Misty action creates an idempotent `space_runs` record and links it to the durable AI conversation.
2. The Go scheduler dispatches the run to the Vercel Workflow runtime using the existing signed control-plane protocol.
3. Before each tool call, Vercel exchanges its signed run identity for a fresh five-minute bearer credential.
4. At run start, the Vercel worker uses the official TypeScript MCP client to discover the run-scoped tools and converts remote MCP JSON Schemas into model-visible tools. It then calls the Go server's `POST /mcp` Streamable HTTP endpoint with a fresh credential for each execution.
5. The Go server verifies the bearer signature and expiration, then revalidates the user, Misty run, and Vercel runtime binding in PostgreSQL.
6. Only tools allowed by the canonical typed registry are advertised. Every call passes through schema validation, Space permissions, approval policy, device grants, idempotency journaling, and audit logging.
7. Runtime events and completion project back into the same conversation. The run remains safe to poll, cancel, retry, or revisit after an app restart.

The control-plane secret never becomes an MCP bearer token. The exchanged token is audience-bound to Misty MCP, bound to one user/run/runtime tuple, short-lived, returned with `Cache-Control: no-store`, and accepted without cookies. Secret rotation accepts the current and immediately previous signing key.

## MCP surface

The server uses `github.com/modelcontextprotocol/go-sdk` and protocol-native tool definitions. Canonical JSON Schemas become MCP input/output schemas. Tool annotations expose read-only, idempotent, destructive, and open-world hints, while Misty metadata records risk, approval class, locality, and descriptor version.

The endpoint is stateless JSON Streamable HTTP with a one-megabyte request limit and request-cancellation propagation. It is intentionally run-scoped; permanent public MCP keys are not accepted. This keeps cloud workers horizontally scalable and prevents a leaked client token from becoming standing access to a Misty account.

## Managed tools and workers

Connecting a remote MCP server is the user-facing grant. Valid tools from active connections are synchronized to managed Misty automatically. Remote tool calls remain interactive, audited, schema-fingerprint checked, and revocable by disconnecting the server.

Misty exposes up to 50 connected remote tools to the model in a run, in addition to its native application tools. This bound keeps prompts and provider tool limits predictable; the Go server remains the authoritative filtered catalog and rejects any stale or unadvertised call.

Misty can delegate at most three direct background workers from a run and at most two levels deep. Child runs inherit the parent's Space and cannot increase its run mode. They are ordinary durable runs for cancellation, retry, billing, and audit purposes, but they are displayed as background work rather than separate assistants.

## Deployment requirements

- The Go API must be reachable from Vercel over HTTPS. Go sends its
  `MISTY_AGENT_RUNTIME_INTERNAL_API_URL` in the signed run request, and Vercel
  keeps the matching `MISTY_INTERNAL_API_BASE` as a rolling-deployment fallback.
- Go and Vercel must share a 32-byte-or-stronger `MISTY_AGENT_RUNTIME_CONTROL_SECRET`; rotate with the previous-secret setting during deploys.
- The API must run the managed-Misty migration before accepting traffic.
- Vercel egress must reach the API origin. A private origin may be exposed through a private network or authenticated tunnel, but the application protocol remains the same.
- Logs and traces must redact authorization headers and remote MCP credentials.

During a rolling deploy, the Vercel client falls back to the legacy signed tool endpoint only when the token exchange route is explicitly unavailable (404, 405, or 501), and only before a tool call. It never retries a consequential call through two transports.

## User-visible features

- One Misty identity and one natural composer across the app.
- Automatic answer-versus-action routing and automatic Space choice from attached context or the most recently active eligible Space.
- Durable work that survives closing the window or restarting the app.
- Live working, approval, device-wait, completion, failure, cancel, and retry states.
- Background parallelism without a user-managed agent roster.
- Native Misty tools plus connected remote MCP tools with typed schemas.
- Exact approvals for consequential, dangerous, external, paid, and device actions.
- Per-run audit trails, tool journals, idempotent request replay, and revocable connections.

## Deliberate non-features

- No user-selected model, reasoning effort, system prompt, run mode, voice persona, or custom-agent editor.
- No permanent bearer token for the run-scoped MCP endpoint.
- No direct browser-to-MCP credential flow and no cookie authentication on `/mcp`.
- No separate conversations with background workers.
