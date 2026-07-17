# Mika, Spaces, Agents, and Workflows

This document defines the canonical execution hierarchy:

```text
Mika
  discovers authorized capabilities across Spaces
    Space
      owns Agents, workflows, integrations, permissions, and shared chat
        Agent
          has exactly one active immutable workflow version
            Workflow package
              exposes one or more structured capabilities
```

## Ownership and identity

`space_agents` is the only shared agent catalog. Every Agent has a non-null `space_id`. Device-backed folder Agent definitions remain execution bindings in `agent_definitions`, linked one-to-one through `space_agent_id`; they are not a second ownership system.

Agent identity (`name`, `description`, `icon`, `instructions`, availability, runtime) is separate from workflow behavior. Updating identity does not switch behavior. `active_workflow_version_id` is the one active behavior pointer, and it changes only through the explicit workflow-replacement operation.

Deleting an Agent disables or removes its catalog entry without rewriting historical run snapshots. A workflow version referenced by a run is protected by a restrictive foreign key.

## Portable workflows

`space_workflows` stores package identity and provenance. `space_workflow_versions` stores immutable snapshots. A snapshot includes:

- stable identifier and semantic version;
- name, description, author, checksum, and provenance;
- one or more capabilities;
- typed capability inputs and outputs;
- read-only, destructive, and confirmation flags;
- required Space integrations and permissions;
- runtime kind and compatibility;
- searchable tags and portable definition JSON.

Destructive capabilities must require confirmation. Unknown permission declarations are rejected. New versions never mutate old versions, and each run pins the exact version ID, identifier, version string, and capability ID used.

The schema already contains source/fork fields and suggested Agent presets so install and fork behavior can be added without changing execution semantics. A public marketplace, ratings, monetization, and discovery ranking are intentionally deferred.

## Invocation and routing

All invocation paths create `space_runs` records:

- direct Agent runs;
- private Agent conversations;
- shared Space `@Agent` mentions;
- Mika delegations;
- Studio tests and scheduled runs.

The server discovers only enabled Agents in Spaces where the requester is a member and has `agents.run`. Routing scores structured capability IDs, names, descriptions, and tags. It never routes from display names alone. An explicit Space, Agent, or capability selector narrows that authorized catalog. Ambiguous matches return a clarification question and authorized options.

Runs record requester, Space, source conversation and source type, Agent, pinned workflow, capability, state, progress, inputs, outputs, artifacts, errors, retries, cancellation, timestamps, action records, and approval records. Device jobs carry the canonical `space_run_id`; job progress and terminal states synchronize back to the Space run.

## Privacy and authorization

Server authorization is required for discovery, invocation, workflow management, integration management, approvals, cancellation, retry, and run detail access. Client filtering is only presentation.

Private Agent conversations are owner-scoped tables with forced row-level security. Their events and non-shared runs are visible only to the requester. Shared `group_mention` runs are visible to authorized Space members. RLS and repository checks both enforce the boundary.

Integrations belong to a Space. The database stores only an opaque provider-vault reference; API responses never return that reference. A run is rejected before execution if an active required integration or required permission is unavailable.

Destructive or confirmation-required capabilities enter `awaiting_approval`. The requester sees the proposed action, workflow version, and capability and must approve or reject it. Approval rechecks membership, permissions, integration state, and the pinned workflow before execution.

## HTTP surface

The primary endpoints are:

- `GET /api/agents/catalog` and `GET /api/mika/discovery`
- `POST /api/mika/delegations`
- `GET|POST /api/spaces/{spaceID}/agents/{agentID}/runs`
- `PUT /api/spaces/{spaceID}/studio/agents/{agentID}/workflow`
- `GET|POST /api/spaces/{spaceID}/studio/workflows/{workflowID}/versions`
- `GET /api/runs/{runID}`
- `POST /api/runs/{runID}/approval`, `/cancel`, and `/retry`
- `GET|POST /api/agent-conversations`
- `GET|POST /api/agent-conversations/{conversationID}/events`
- `GET|PUT /api/spaces/{spaceID}/integrations`

Shared chat continues to use the Space message endpoint. Agent mentions are routed and executed through the same canonical run service.

## Migration and rollback

Migration `20260825000000_version_space_workflows_and_runs.sql`:

1. canonicalizes legacy device Agents without changing their IDs;
2. creates default portable workflow packages and immutable `1.0.0` versions;
3. attaches one active version to every Agent;
4. enriches existing runs and adds approvals, actions, integrations, and private conversations;
5. replaces membership-wide run RLS with requester-private/shared-mention policies.

The migration is reversible. Use a database owner for DDL with `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`; the runtime role remains least-privileged. `scripts/goose.sh down` restores the pre-versioned schema and membership-wide legacy run policy. Back up production data before rollback because version, approval, integration, and private-conversation tables are removed by the down migration.
