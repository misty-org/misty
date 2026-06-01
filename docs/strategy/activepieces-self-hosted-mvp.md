# Self-hosted Activepieces automation MVP

**Status:** Implemented MVP boundary  
**Owner:** Misty Agents  
**Cost constraint:** No Activepieces license or hosted-service fee

## Decision

Run Activepieces Community Edition beside Misty. Misty remains the product surface and agent
runtime; Activepieces supplies triggers, app connections, flow execution, and its advanced visual
editor. The Agents destination contains the existing **Chat** and **Automations** subsections.

Misty's server owns the one configured Activepieces MCP URL. Users no longer paste arbitrary MCP
addresses or create Activepieces Cloud accounts. They authorize against the operator's instance,
and Misty stores the resulting OAuth credentials encrypted as before.

## Included

- Activepieces app plus one separate worker.
- Dedicated PostgreSQL and Redis services and persistent volumes.
- Loopback-only editor port for publishing through the operator's HTTPS proxy or tunnel.
- A fixed `MISTY_ACTIVEPIECES_MCP_URL` derived from the public Activepieces URL.
- Activepieces telemetry, queue UI, and paid AI tool search disabled.
- Existing Misty approval and MCP-tool allowlist boundaries.
- A Misty-native connection, empty, loading, error, and connected experience.

## Operating boundary

Community Edition is free and open source, but the containers consume the operator's existing CPU,
memory, disk, backup capacity, and third-party API quotas. This MVP adds no software subscription.
Activepieces remains visible for initial sign-in, app OAuth, and advanced drag-and-drop editing; it
is not embedded or white-labeled.

The first operator opens the Activepieces public URL, creates its administrator account, and enables
**Settings → MCP Server**. Each Misty user then chooses **Connect** in Agents → Automations and
authorizes access to the operator-managed project.

## Security and data

- Activepieces Postgres and Redis are reachable only on a private Compose network.
- The worker reaches the app API and external integrations, but not the database or Redis network.
- The editor binds to `127.0.0.1:8090` by default; TLS terminates at the operator's proxy/tunnel.
- App connection secrets live in Activepieces. Misty stores only encrypted MCP OAuth credentials.
- Backups must cover the Activepieces Postgres, Redis, and cache volumes with the same care as the
  Misty database and Library data.

## Deferred

- Misty-to-Activepieces SSO or automatic account provisioning.
- Embedding or white-labeling the Activepieces visual builder.
- A Misty-native drag-and-drop flow canvas.
- Multi-instance or per-user Activepieces isolation.
- Paid Activepieces editions and paid semantic tool search.
