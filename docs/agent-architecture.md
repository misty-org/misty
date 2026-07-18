# Unified Agent Workflow Platform

The canonical hierarchy is:

```text
Space
  shared Workflow drafts -> immutable WorkflowVersions
  shared Agent draft -> immutable AgentVersions -> pinned WorkflowVersions
  member -> internal AgentInstance -> member-isolated runs, triggers, cursors, grants, connections, memory, approvals, and results
```

Only Agents execute. An Agent can handle ordinary chat with no workflow. A workflow adds automatic triggers and a repeatable, typed execution plan; it is never an execution principal and has no standalone run endpoint.

## Definitions, ownership, and access

Workflow drafts and immutable versions are visible to Space members. Only the Workflow creator may edit or publish. Published definitions use `formatVersion: 2`, typed nodes and ports, a capability envelope, dependency locks, and a checksum. Publication resolves every pinned subflow, rejects missing versions and recursive dependencies, and never mutates a version already used by a run.

Only an Agent creator may edit or publish it. An `AgentVersion` freezes its identity, instructions, access policy, and any number of version-pinned workflow attachments. Access defaults to every member of the Space; the creator may select specific members. Sharing an Agent shares only its definition—not a running session or usage state.

`AgentInstance` is internal runtime state belonging to one member. It pins an Agent version and owns that member's connection references, capability grants, workflow enablement, trigger configuration, cursors, memory checkpoints, and derived idle/running state. A newly published Agent version is offered as an update. An instance can update only when it has no queued, running, cooldown, or approval-blocked run. Updating clears capability grants so expanded access is consented again.

## Runtime

Every run pins its Agent instance, Agent version, optional Workflow version, inputs, attempts, checkpoints, action journal, approvals, and trace data. Terminal states are `completed`, `completed_with_errors`, `failed`, `canceled`, and `rejected`. Nonterminal states are `queued`, `running`, `cooldown`, and `awaiting_approval`.

The v2 engine validates the graph and capability envelope before execution, resolves nested typed ports in topological order, validates every node output, and checkpoints every transition. Condition and switch ports skip inactive branches; `For each` executes an inline child graph or pinned subflow with bounded concurrency. Nodes receive three total attempts and a stable idempotency key. A failed attempt enters a persisted one-minute cooldown. Mutations use the action journal and must be idempotent or reconcilable. Resource leases serialize conflicting mutations and preserve the resource fingerprint used for revalidation.

Device-only capabilities fail an attempt with `device_unavailable` when no trusted device lease can execute them; they do not wait indefinitely. Cloud providers execute on the server. The effective tool set is the intersection of the Workflow envelope, pinned Agent access, user grants, resource ACLs, and healthy providers.

Mika and Agent chat use the same discovery catalog and canonical run service. The catalog always advertises ordinary chat, plus capabilities from every attached workflow. Mika's existing tool-call loop remains the tool-call transport; workflow Agent-task nodes use the same managed Mika runtime inside a finite, schema-validated graph step.

## Content and built-ins

`ContentRef` carries provider-neutral identity, version/fingerprint, MIME type, locator, and permission scope. `ContentPage` returns normalized sections, citations, truncation state, and continuation. Credentials and raw local paths are never embedded in either object. Cloud and leased-device readers support bounded text, JSON, XML, YAML, CSV, PDF embedded text, and native Office text with checksum verification. Images and image-only PDFs fail with `unsupported_content`.

The launch registry covers manual/chat, cron, file, Library, Space task, Google Calendar, Slack, Discord, and Notion triggers; changed files, source queries, content/metadata reads and transforms; condition, join, debounce, delay, bounded `For each`, and pinned subflows; Agent tasks; and explicit document, Library, task, notification, approved message, metadata, memory, deletion, and permission actions. Provider callback receivers are private infrastructure and there is no generic inbound endpoint.

Event claims are keyed by user instance, Workflow version, provider, and event ID. This prevents cross-user cursor sharing and makes reordered delivery and concurrent claims safe. Successful items checkpoint independently. Generated artifacts can be excluded through provenance and paths such as `.summaries/**`.

Cloud Library artifact writes use the normal immutable object, quota, deduplication, ACL, audit, and provenance path. Space-message replies use normal destination ACLs. Any mutating node without a concrete provider adapter returns `workflow provider missing`; it is never action-journaled as a false success.

## Safety and privacy

Reads within granted scopes run automatically. Scoped writes may be consented when a user enables a workflow. Deletions, permission changes, and high-impact or bulk outbound actions always enter `awaiting_approval`. Approval rechecks the user's membership, resource ACL, provider health, consent, and pinned versions.

Member conversations, runs, steps, workflow settings, event claims, memory, action journals, and leases use requester/instance-scoped access controls. Provider credentials are member connection references and are never inherited from a creator. Proactive results default to the member's Agent Center results; a shared post requires an explicit action and destination permission.

## HTTP surface

- `GET /api/agents/catalog`, `GET /api/mika/discovery`, `POST /api/mika/delegations`
- `GET|POST /api/spaces/{spaceID}/agents/{agentID}/runs`
- `GET|POST /api/spaces/{spaceID}/studio/workflows/{workflowID}/versions`
- `GET|POST /api/spaces/{spaceID}/studio/agents/{agentID}/versions`
- `GET|POST /api/spaces/{spaceID}/agents/{agentID}/instance`
- `PUT /api/agent-instances/{instanceID}/workflows/{workflowVersionID}`
- `PUT /api/agent-instances/{instanceID}/connections`
- `GET /api/runs/{runID}` and `POST /api/runs/{runID}/approval|cancel|retry`
- `GET|POST /api/agent-conversations` and their member-isolated event endpoints

There is intentionally no Workflow run endpoint and no Agent workflow-replacement endpoint.

## Fresh cutover

Migration `20260831000000_unified_agent_workflows_v2.sql` preserves valid Space Agents and backfills their first immutable versions. It deletes only known retired device/folder runtime tables and standalone legacy Workflow runs, then installs the v2 definition and member-instance tables. Accounts, Spaces, chats, provider connections, Libraries, ordinary files, Space Agent conversations, and trusted devices are preserved. The migration never recursively deletes Library roots.

The desktop no longer contains the Rust automation runner, `.mf` import/export contract, or a second TypeScript workflow planner/node model. The remaining device-resource API is a signed lease transport for local scopes; it does not define or traverse a workflow graph.

The retired runtime-table cleanup is irreversible. Take a database backup before cutover if an environment must retain those obsolete records.
