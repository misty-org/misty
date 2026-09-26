# CLI and server consolidation

The development checkout now contains `server/` and `cli/`. The CLI owns environment layout, setup, startup, diagnostics, and development Worker deployment.

## History and migration

The local import commit `186fbb5d` has the prior Misty commit and the original server head `eb9afc4d` as parents. All 66 commits reachable from that server head retain their original IDs, authors, dates, and messages. This is an unsquashed history import. `git log 186fbb5d^2` shows the original server history.

The existing server working files were copied into `server/`, including uncommitted changes. Private environment files and collaboration secrets were copied separately and remain ignored. The sibling repository remains available as a recovery copy; it is no longer the CLI's server target. Existing unrelated Misty working changes were not included in the import commit.

Compose retains the `misty-server` development project name and the main database volume. The retired workflow database volume is preserved during consolidation. Production retains `misty-server-production`. Do not run both checkouts' development stacks concurrently: they intentionally address the same project.

## Development container layout

The development stack has four ongoing services: `postgres`, `misty-api`,
`agent-runtime`, and `tunnel`. One `setup` container waits for Postgres, runs the
API migrations, synchronizes application permissions, initializes the separate
`workflow` database and its migrations, and copies collaboration configuration.
The API and agent runtime wait for successful setup. Completed setup jobs are
hidden from normal status; failed or unfinished jobs remain visible.

Setup copies Goose and migrations from the actual API image, and workflow
dependencies from the actual agent runtime image through Compose build contexts.
Goose is statically linked so it can also run in the Alpine setup image.
`misty server deploy` runs `setup deploy` as a temporary container with automatic
removal. It uses the same tooling image and skips startup migrations. Ordinary
startup does not publish a Worker.

Before removing legacy containers, `misty server up` runs
`server/scripts/docker/consolidate-workflow.sh`. The one-time upgrade stops API
and agent consumers, saves a private SQL backup under `server/.misty/backups/`,
restores workflow data into the existing Postgres 16 instance under its own role,
and compares every user table's row count. An existing destination is never
overwritten. A failed restore removes only the new partial destination and
restarts previously running consumers against their original database. The
original database volume is retained. Use the updated CLI for the first startup;
running Compose directly bypasses this migration guard.

Production and self-hosted Compose layouts are unchanged by this development
consolidation. The separate billing stack is also unchanged.

Validation: the setup image builds; fresh and repeated setup succeed; roles cannot
connect to the other application database; migration failure stops later steps;
deployment mode skips startup; a seeded Postgres 18 database transfers to 16;
an existing destination is protected; an incompatible restore preserves the
source. Run `python3 server/scripts/test-consolidated-setup.py` after building the
setup image to repeat these checks using disposable Docker databases.

The running development stack was upgraded and all four services are healthy.
The agent runtime can read the migrated workflow database with its restricted
role (94 preserved runs). All 61 CLI tests, Clippy, formatting, and container
contract checks pass. Wrangler also bundles the Worker successfully in the new
setup image with `deploy --dry-run`; no remote deployment was performed.

## Implementation and validation

| Work | Implementation | Validation |
| --- | --- | --- |
| Server history import and CLI paths | Implemented | Original server head is an ancestor of the import; existing stack starts from `server/`. |
| Environment ownership and setup | Implemented | Tests cover fresh generation, repeated and interrupted setup, unchanged secrets, setting ownership, literal values, and invalid origins. Fresh-checkout smoke tests validate generated Compose configuration with fixture credentials. |
| Scoped doctor | Implemented | Server checks pass against Docker, matching key bundles, port ownership, and the running migrated stack. Cloudflare access, Worker deployment, and public API health checks pass; structured findings supported. |
| Cloudflare setup | Implemented | Identifier and route-preservation tests pass; live provisioning on a fresh account remains unverified. |
| Explicit Worker deployment | Implemented | Deployment reuses the setup image in an automatically removed container and is excluded from ordinary startup; no live deployment performed during consolidation. |
| Quiet startup and focused logs | Implemented | Migrated stack starts with compact status; private redacted subprocess diagnostics tested. |
| Container logging and caching | Implemented | Compose contract checks pass; development logs rotate; BuildKit caches declared; the migration binary includes PostgreSQL support only. The PostgreSQL-only migration binary built successfully. A fresh complete API image remains unverified: Docker Desktop restarted twice, interrupting builds with an EOF from the engine, including the retry with Go parallelism limited to two workers. |
| CI and documentation paths | Implemented | Server workflows moved into root `.github/workflows`; remote CI has not run. |

## Decisions and remaining coverage

The full development stack still requires Cloudflare. The API depends on the agent runtime and workflow services, and collaboration callbacks use the public API. Optional service profiles and a full local-only collaboration mode need separate dependency work; they are not advertised as available.

Doctor checks service readiness and completed job status, not the success of account, encrypted sync, billing, or agent workflows. End-to-end application validation and a fresh-account Cloudflare provisioning test remain required before calling the new contributor flow fully verified.

Normal startup no longer follows every service's logs. Use `misty server logs SERVICE --tail 100 --follow` when investigating a service. Bounded private build logs are in `server/.misty/logs/`. `misty server deploy` is the explicit remote Worker deployment command.

## Checks performed

- 61 CLI tests and Clippy with warnings treated as errors pass.
- Fresh-checkout setup and repeated setup succeed; generated Compose configuration validates with fixture Cloudflare values.
- Existing development containers start from `server/` with the original project and database volumes.
- Server doctor passes tool, environment, private key matching, host port, and container checks.
- Cloudflare doctor passes API access, existing Worker deployment, and public API health checks.
- Setup documentation links and targeted diff whitespace checks pass.

The updated CLI was installed locally. The existing stack was brought back up after Docker recovered.

No changes have been pushed. No new Cloudflare resources were provisioned or Workers deployed during validation. Existing Cloudflare resources were checked read-only.
