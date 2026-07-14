# Mika Smart Library and Explorer semantic search

Misty uses its existing desktop app and `misty-server`; it does not require a Vercel Blob bucket, Queue consumer, or a second Vercel deployment:

`Explorer search → misty-server → Vercel AI Gateway → Postgres + pgvector`

Mika is the scan, review, and index-management surface. Search belongs to Explorer's existing global search bar. Explorer returns local filename/path matches immediately, requests semantic matches after a short debounce, fuses the two rankings, and resolves the server's opaque asset IDs to paths only on the user's device.

## Deployment and migration

Deploy the existing `misty-server` and apply migrations through `20260718000000_claim_semantic_reindex_assets.sql` with the database-owner migration role. PostgreSQL must have pgvector available; the migrations enable the `vector` extension and add:

- 768-dimensional Gemini Embedding 2 vectors with an HNSW cosine index.
- A generated weighted `tsvector` with a GIN index.
- Tenant-denormalized asset ownership for filtered vector search and RLS.
- Embedding model, version, fingerprint, failure, cost, explicit reindex state, and stale-safe per-asset claims that prevent replayed requests from repeating provider calls.

The catalog schema is not constrained to 500 rows or one server-side root. The current desktop pilot still selects one root and analyzes a maximum of 500 files after its included sample; that root may be an entire disk, and catalog snapshots/results are paginated.

Required and optional environment variables:

- `AI_GATEWAY_API_KEY` — required for analysis and semantic embeddings.
- `AI_GATEWAY_BASE_URL` — optional; defaults to Vercel AI Gateway's compatible endpoint.
- `SMART_LIBRARY_PRIMARY_MODEL` — defaults to `google/gemini-2.5-flash-lite`.
- `SMART_LIBRARY_FALLBACK_MODEL` — defaults to `google/gemini-3-flash`.
- `SMART_LIBRARY_EMBEDDING_MODEL` — defaults to `google/gemini-embedding-2`.
- `SMART_LIBRARY_SEARCH_DAILY_LIMIT` — defaults to 500 uncached semantic queries per account/day.
- `SMART_LIBRARY_PRICE_MINOR_PER_IMAGE` and `SMART_LIBRARY_PRICE_CURRENCY` — optional customer estimate.
- `SMART_LIBRARY_EMERGENCY_DISABLE=true` — stop new analysis and charges.
- `SMART_LIBRARY_SEARCH_EMERGENCY_DISABLE=true` — keep lexical search while disabling query embeddings.

## Private desktop ingestion

The desktop catalog and path resolver use `~/.misty/.cache/smart-library/v1.sqlite3`. Local paths and filenames never enter the server requests. The client sends only opaque IDs, fingerprints, bounded representations, and path-free technical metadata after explicit approval:

- Images: re-encoded, EXIF-free 384–512 px JPEG previews.
- Text and source files: at most 64 KiB of text.
- PDF, DOCX/XLSX/PPTX, OpenDocument, EPUB, and RTF: bounded extracted text; never the original file.
- ZIP-family archives: capped member basenames and aggregate metadata, never member content or paths.
- MP3: bounded ID3 metadata; other audio formats are metadata-only.
- Unknown or executable binaries: size, extension, and a short magic signature only; printable strings and embedded secrets are not extracted.
- Video: rejected by extension, MIME type, and transport-stream sniffing.

Hidden files/directories are skipped. Extraction and request sizes, archive entries, declared expansion, image dimensions, PDF size, batch size, and processing time are bounded. Corrupt or adversarial files fail individually. Unchanged fingerprints are not reopened, uploaded, charged, or reprocessed.

## Analysis, embeddings, and ranking

The analysis schema captures a description plus content type, primary subject, retrieval phrases, entities, fictional characters, brands, applications, objects, scenes, activities, colors, OCR text, topics, collections, and confidence. The prompt explicitly inspects both an interface and prominent background art, which covers cases such as a file manager displayed over Pikachu artwork without encoding that benchmark answer in the production prompt.

The low-cost primary is retried with Gemini 3.1 Flash Lite for invalid, generic, sparse, interface-incomplete, or low-confidence metadata. Index v3 also runs that stronger visual-entity audit when an interface screenshot mentions background art or wallpaper but identifies no character or brand; the two valid metadata records are merged. Each successful asset is embedded in the same 768-dimensional multimodal space as search queries. Image vectors use the thumbnail plus normalized metadata; document and other non-image vectors use bounded extracted content, generated metadata, and safe technical metadata.

Server ranking retrieves tenant-filtered lexical and approximate-nearest-neighbor candidates, then combines semantic similarity (68%) and lexical relevance (32%). When exact metadata matches exist, low-scoring visual lookalikes are pruned while all lexical matches and close semantic neighbors remain. Explorer uses reciprocal-rank fusion again when combining server results with its local index because those scores use different scales. Results appear in the existing Explorer search with local thumbnails, generated summaries, and compact source context. If the server, Gateway, or network is unavailable, Explorer silently remains usable as local-only search.

## API

All routes require the Misty account session and exist under both `/ai/smart-library` and `/api/ai/smart-library`:

| Route | Purpose |
| --- | --- |
| `POST /search` | Global tenant-scoped hybrid semantic search |
| `GET /index-status` | Count outdated or failed vectors |
| `POST /reindex` | Create a free, explicit, paged reindex plan |
| `POST /reindex/:jobID/complete` | Submit an approved batch and persist new vectors idempotently |
| `POST /folders` | Register a catalog root |
| `POST /folders/:id/preflight` | Save counts and price the pilot allowance |
| `POST /folders/:id/sample` | Fix a representative sample |
| `POST /folders/:id/sample/approve` | Analyze an included sample batch |
| `POST /folders/:id/approve` | Analyze a paid batch, settling only successful files |
| `GET /folders/:id/progress` | Sync processing and index status |
| `GET /folders/:id/results?after=N` | Incrementally sync generated metadata |
| `PUT /folders/:id/assets/:assetID/tags` | Add or remove tags for one analyzed file |
| `POST /folders/:id/rescan` | Price new/changed files without invoking AI |
| `POST /folders/:id/search` | Compatibility folder-scoped hybrid search |
| `DELETE /folders/:id` | Delete the server catalog, vectors, jobs, and generated metadata |

Global search responses never contain device paths. Requests are size-limited and schema-strict; opaque IDs are validated; queries are bounded, cached by a non-reversible hash, rate-limited, daily-limited, and not stored with usage events. RLS and explicit `user_id` predicates protect both lexical and vector branches.

## Billing, reindexing, and evaluation

Analysis retains the outcome-based `asset_analysis_image` meter for compatibility: the included sample is free, paid batches reserve credits, failures and provider/schema retries are absorbed, and only successful assets settle. Semantic usage is recorded separately without query or generated-content logs. Reindex planning is free and never uploads or invokes a model; completing a reindex requires an explicit user approval in Library. Index v2 added sparse legacy-caption repair; index v3 adds the focused background-art entity audit. Tags live in the managed catalog and individual user corrections update lexical search immediately.

The manifest-driven quality command compares candidate metadata models and cross-modal retrieval on the same labeled corpus:

```sh
SMART_LIBRARY_EVAL_LIVE=1 go run ./cmd/smart-library-eval \
  -live -manifest /absolute/path/to/private-eval-manifest.json
```

The example manifest is `misty-server/agent/testdata/smart_library_eval.example.json`. Keep private fixtures outside the repository. Production rollout should gate on labeled metadata term recall, recall@K, fallback rate, per-file cost, and sample-to-full conversion rather than model confidence alone.
