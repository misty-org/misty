# App session request storm investigation

The September 10 console screenshot shows repeated POST requests to the Files
session endpoint returning 429. It also contains separate device-registration
409 and app-runtime RPC 424 failures; those status codes alone do not identify
their server-side causes.

## Confirmed request amplifiers

- `withNativeDocumentService` opens a short-lived native instance for each
  document, image, and search operation. The connected-device controller also
  uses it for a long-lived Files service. Each entry previously issued an
  independent server session request, even when other callers already held a
  valid session for the same account, Space, app, and authority generation.
- Session requests had neither shared in-flight work nor a shared 429 deadline.
  Repeated operations/remounts continued making requests during rate limiting.
- `useAppsStore.load` replaced catalog and installation references on every
  successful authority poll, even if their JSON contents were unchanged.
  `OfficialAppRuntimePage` derived a new development-release object and depended
  on it in the connect effect. Its existing release pin applied only after a
  successful connection, leaving pending and failed connections susceptible to
  refresh-triggered retries.
- The session refresh timer accepted malformed expiry dates. A NaN delay can
  become an immediate browser timer rather than a sensible renewal interval.

## Changes

Session acquisition now shares in-flight work and valid tokens. The cache is
memory-only and keyed by authenticated API generation, app, Space, and authority
generation; it renews 45 seconds before expiry. Unbound/mismatched responses are
not cached. Account changes clear cached work and reject late responses. Personal
connection changes and RPC 401/403 responses invalidate the affected token cache.
A 429 sets a shared Retry-After deadline (60 seconds if absent). Other failures
have a five-second suppression period. No automatic retry queue is created.

Native helpers also coalesce concurrent installation/authority reads without
caching completed reads. Each subsequent operation still checks current access.
Native instances, file handles, scope ceilings and cancellation remain separate.

Unchanged catalog/Space data keeps its references. Runtime release identity is
stable across equivalent refreshes even before successful connection. Genuine
release/authority changes still invalidate it. Invalid/expired session responses
become an explicit connection error instead of starting a refresh timer.

## Verification and remaining scope

Tests exercise concurrent and sequential calls, expiry renewal, Retry-After,
account/authority isolation, connection invalidation, repeated identical store
refreshes after session failure, explicit retry, malformed expiry, and concurrent
native authority reads. Existing native-helper, RPC, Search, and API request tests
were also run. TypeScript validation covers the host frontend.

This is a source-level investigation with regression tests, not a measurement of
the running app's network traffic. Device 409 and provider RPC 424 responses remain
visible and need their structured server error codes to diagnose precisely.
