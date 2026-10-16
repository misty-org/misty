# Frontend API boundary

`src/api` owns Misty server transport, endpoint paths, and wire-facing request and response
contracts. Product features consume domain clients; they do not construct server routes or reuse a
different domain's request primitive.

## Layers

- `client/` — neutral HTTP, authentication, account-session isolation, base URL, and error handling.
- `deployment/` — the Hosted API base and the local storage namespace.
- `account/`, `activity/`, `agents/`, `ai/`, `assistant/`, `cloud/`, `devices/`, `drawings/`,
  `extensions/`, `integrations/`, `journal/`, `notes/`, and `search/` — domain endpoint clients.
- `spaces/` — Space endpoints plus Space-only reference-mode behavior and Library transfer policy.

Use `apiRequest` for account-wide Misty endpoints. Use `spaceRequest` only inside API modules whose
resources belong to a Space and must honor Space reference-only mode. Direct external URLs, such as
signed object-storage transfers, use `httpRequest` with their explicit credential policy.

## Saved copies (the API cache)

`cache/` keeps copies of fetched account data so a page paints at once on a repeat visit. On
desktop they are encrypted under `~/.misty/cache/api` (`src-tauri/src/infra/api_cache.rs`, key in
the OS keychain); there is an in-process layer in front, and it is all the web build has.

- Read a GET with `cachedRequest(path, { onCached })`: it calls `onCached` with the saved copy
  (when there is one), then resolves with the fresh response and saves it. Domain clients take
  an optional `onCached` and pass it through; a store paints from it only while it has nothing
  loaded. A failed refresh leaves the saved copy on screen. Requests always bypass the web view's
  HTTP cache, so call sites do not set `cache: "no-store"`.
- A write through `apiRequest` drops the saved copies under the first two path segments
  (`/spaces/{id}`); the next read revalidates. Signing out or removing an account clears its
  copies.
- Never saved: credentials, one-time links and signed URLs. Keep those on `apiRequest`.
- Not yet covered: the rest of the Spaces, notes, drawings and journal reads (phase 2).
