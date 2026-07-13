# Mika Smart Library managed backend contract

The desktop repository implements device discovery, one-root enforcement, fingerprinting, representative sampling, private preview generation, result storage, visual review, and the managed API client. The adjacent `misty-server` repository now implements the authenticated catalog, server-side constraints, estimates, durable batch records, Vercel Queue publication, and Gateway analyzer. Production analysis still requires the private Vercel Blob upload broker and a deployed Queue consumer that calls the analyzer and settles successful-image billing.

## Required routes

All routes are under `/api/ai/smart-library`, require the existing Misty account bearer token, and scope every query by the authenticated account.

| Route | Purpose | Required server invariant |
| --- | --- | --- |
| `POST /folders` | Register one opaque client library | Unique active folder per account; reject a second root |
| `POST /folders/:id/preflight` | Return authoritative allowance and price | Clamp requested analysis to remaining capacity and 500 total successes |
| `POST /folders/:id/sample` | Select up to 25 candidates | Stratify by extension, modified bucket, and stable candidate distribution |
| `POST /folders/:id/preview-authorizations` | Mint short-lived private uploads | At most eight; MIME and byte limits; authorization owned by account/folder/asset |
| `POST /folders/:id/sample/approve` | Create sample batches | Durable DB job first, queue publish second; no charge until asset succeeds |
| `POST /folders/:id/approve` | Create full-folder batches | Recheck estimate, daily budget, duplicate fingerprint, and 500-success cap transactionally |
| `GET /folders/:id/progress` | Return resumable job state | Does not expose generated content or paths |
| `GET /folders/:id/results?after=N` | Incremental result sync | Monotonic sequence; account-scoped; independently retryable assets |
| `POST /folders/:id/rescan` | Reprice new/changed work | Never starts analysis without a later approval |
| `POST /folders/:id/search` | Semantic search over normalized metadata | Embed query only; return opaque asset IDs and scores |
| `DELETE /folders/:id` | Delete managed catalog | Revoke jobs/uploads, delete metadata/embeddings, release one-root constraint |

## Vercel processing

1. The Function records an idempotent job and asset rows before publishing a Vercel Queue message.
2. The browser uploads directly to private Blob storage using the short-lived authorization. The Function never proxies image bytes.
3. A queue consumer claims at most eight assets, verifies Blob ownership and expiry, and invokes Vercel AI Gateway.
4. The primary route is `google/gemini-2.5-flash-lite` with minimal thinking and the strict schema in `src/contracts/smartLibrary.ts`.
5. The worker retries an individual asset once with `google/gemini-3.1-flash-lite` only for a schema failure, generic/empty description, missing required metadata, or confidence below the corpus-calibrated threshold.
6. Successful normalized description/tags are embedded with `text-embedding-3-small`. A single Gemini 3.1 Flash Lite text call names folder collections after the folder run completes.
7. The billing transaction increments `asset_analysis_image` exactly once per successful asset. Provider/schema/infrastructure retries never increment it.
8. Delete the Blob after success. A scheduled cleanup deletes every remaining preview within 24 hours.

Vercel Queues provide at-least-once delivery, so every consumer must use `(folder_id, asset_id, fingerprint)` as its idempotency key. The database job ledger is the source of truth; the queue is not the job database.

## Data and privacy boundaries

The server stores account ID, folder ID, opaque asset ID, fingerprint, generated metadata, embedding, model/cost telemetry, billing state, and Blob ID. It must reject fields named `path`, `rootPath`, `relativePath`, or `filename` on write endpoints. Temporary preview objects are private. Do not log request bodies, generated descriptions, tags, paths, or image URLs.

The device SQLite database at `cache/smart-library/v1.sqlite3` is the only Smart Library store containing local/provider paths. Renamed files retain an opaque asset ID when the content fingerprint uniquely matches a missing prior path. Duplicate content remains independently addressable.

## Billing and safety controls

- Server-side ceiling: 500 successful assets per active folder.
- Meter: `asset_analysis_image`; one unit per successful image.
- Sample: 25 units covered by trial/subscription entitlement.
- Pricing: customer unit revenue must be at least 5× the rolling measured variable cost (models, embeddings, Blob, Queue/Function, database/vector storage, and expected retries).
- Enforce per-user daily spend limits, account budget alerts, provider/model circuit breakers, and an emergency analysis disable before queue publication.
- Persist actual provider cost, model, batch size, retry reason, and success/failure without paths or generated content.

Production routing remains disabled until the labeled-corpus comparison of Gemini 2.5 Flash Lite, Gemini 3.1 Flash Lite, GPT-4.1 Nano, and GPT-5.4 Nano clears the agreed tag precision, description usefulness, and search-recall thresholds. GPT-5.6 Luna/Terra are premium explicit actions only and must never be fallback targets.
