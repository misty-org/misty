# Server development

[Setup](../README.md#get-started) · [Architecture](backend-architecture.md)

The API and private billing service are written in Go. Agent execution and
collaboration have separate TypeScript packages. Install the Go version in `go.mod` for native Go
checks and Node.js in the range declared by the package you are working on for
native TypeScript development. The Docker setup builds its runtimes in containers.

## Checks

Run from the Misty checkout:

```sh
misty check server
```

This runs Go formatting, vet, tests, the container contract checks, and the Worker and agent runtime checks. The underlying Make targets remain available from `server/` when investigating an individual check.

The `misty` CLI is maintained alongside the server in `cli/`.

## Repository layout

- `cmd/` and `internal/` — Go API entrypoints and application packages.
- `internal/platform/postgres/migrations/` — clean baseline for fresh databases and supported upgrades.
- `apps/agent-runtime/` — durable AI workflow execution runtime.
- `apps/journal-collab/` — collaborative journal and drawing worker.
- `apps/self-host-collab/` — independently packaged self-hosted Yjs service.
- `deploy/` and `self-host/` — managed and self-hosted deployment assets.

For an isolated migration and browser-server regression run:

```sh
bash scripts/test-browser-server.sh
```

This creates and removes its own temporary PostgreSQL container and never uses
your development database.

## Public SDK contracts

The root Node package maintains the reviewed public SDK snapshot; it does not run the Go API. Use `npm ci && npm run contracts:check` to
verify the shared browser/provider capability schemas. `npm run contracts:sync` updates the schemas from the
reviewed sibling SDK package or an explicit package archive.

## Billing service

Billing lives in the private `misty-org/misty-billing` repository as a standalone
Go service. It is not a workspace dependency. The public adapter is documented in
[billing-adapter.md](billing-adapter.md).

The local API uses adapter `none`; the private writer remains disabled after
reconciled local migration. See [billing status](billing-service.md) before
attempting hosted activation.

## Agent runtime

The agent runtime is part of this backend repository but remains independently
deployable. From `apps/agent-runtime/`:

```sh
npm ci
npm run typecheck
npm test
npm run build
```
