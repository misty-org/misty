# Frontend API boundary

`src/api` owns Misty server transport, endpoint paths, and wire-facing request and response
contracts. Product features consume domain clients; they do not construct server routes or reuse a
different domain's request primitive.

## Layers

- `client/` — neutral HTTP, authentication, account-session isolation, base URL, and error handling.
- `deployment/` and `self-host/` — server selection and self-host entitlement exchange.
- `account/`, `activity/`, `agents/`, `ai/`, `assistant/`, `cloud/`, `devices/`, `drawings/`,
  `extensions/`, `integrations/`, `journal/`, `notes/`, and `search/` — domain endpoint clients.
- `spaces/` — Space endpoints plus Space-only reference-mode behavior and Library transfer policy.

Use `apiRequest` for account-wide Misty endpoints. Use `spaceRequest` only inside API modules whose
resources belong to a Space and must honor Space reference-only mode. Direct external URLs, such as
signed object-storage transfers, use `httpRequest` with their explicit credential policy.
