# Agents workspace

Mode: Operate. Platform: Misty's desktop app.

The account owner starts and returns to ongoing agent conversations, edits an agent’s identity and instructions, and inspects recorded work. Agents belong to the account; profiles do not grant separate app permissions or provision a cloud computer.

## Current approved direction — October 2

Keep the existing Agents directory, including its current All, Agents, Conversations, Activity and Scheduled sections. A selected agent opens a Polar-like workspace with New task, Workflows, Templates, Integrations and recent conversations. New task opens an empty conversation for that agent; a history row opens that specific conversation. Preserve the existing conversation with a bottom composer and optional right-hand details.

The original workspace/catalog implementation was **UI only**. The phase 1–2 extension below now adds the shared run lifecycle and bounded native folder organization. Catalog navigation retains the mounted conversation and its draft. Using a template seeds an unsent draft through the existing discard guard; it never sends automatically. Agent settings opens the existing profile editor. Existing conversation, voice, account connections and profile persistence keep their established behavior.

New workflow and schedule editors, instructions, skill editors and connector browsing are presentation surfaces with React draft state only. Saving workflows, scheduling, saving/importing skills or instructions, connecting catalog apps and executing in another window remain disabled and clearly unavailable. These catalogs introduce no new API, backend, native capability or local-storage persistence; the bounded folder executor is a separate phase 1–2 addition. The work-location control is opt-in for Agents; Scheduled remains unchanged.

The following earlier direction remains historical context. This current direction supersedes its roster-first entry, selected-agent composition and narrow overview Sheet guidance; account boundaries, existing capabilities and draft guards remain applicable. See [DESIGN.md](DESIGN.md) and [implementation evidence](../../../docs/design/agent-workflows/IMPLEMENTATION.md).

## Earlier approved direction

The user supplied Dot onboarding and conversation screenshots and asked to implement their conversation-first organization using Misty’s shared components and styling. Keep Misty’s existing cloud avatars, compact agent roster, an open central conversation with a bottom composer, and one persistent right-hand overview card. At narrower widths the overview uses the shared Sheet. Use restrained shared control and island radii, monochrome UI and status icons, and minimal copy. Existing avatar assets are identity artwork, not status colors.

The overview exposes identity and actual state, message dictation, companion controls, account tool connections, local device availability, recent activity and explicit completed action results. Talk records a message for review; it is not a new realtime calling service. Activity retains its existing inspection, approval and cancellation controls. Outputs must come from completed assistant action results, not inferred attachments or citations.

Create-agent setup has Identity, Context and Start steps. Context reviews account access and opens the existing connection manager; Start offers chat or, on supported native hosts, opening desktop companion controls after creation. Neither choice creates new permissions. Preserve unsaved-profile and unsent-message guards, account boundaries, server persistence and historical conversation routing.

## Implementation boundary

AgentsPage.tsx, agentsWorkspace.css and the feature’s components, including `AgentWorkspaceConversation` and `workspace/AgentWorkspaceFrame`, `AgentWorkspaceCatalog`, `AgentControlBar` and their two stylesheets. Shared controls remain the source of button, input, popover, sheet and panel styling. Settings, Spaces and Scheduled are outside this task. The production-component review harness uses fixture account data, not live user records; visual verification does not establish live backend or native execution.

## Phase 1–2 functional extension — October 2

The Agents conversation, Cmd+Shift+K panel and Talk to Companion use the same account/agent conversation and invocation. Opening a surface preserves its draft and attachments. Active-run follow-ups are durable steering; stopping speech and stopping business work are distinct actions. Automated voice handoff coverage is not a live microphone/speaker acceptance claim.

On supported Unix desktop hosts, Organize folder opens the native picker for one bounded folder. Misty sees visible names, relative locations and sizes, then proposes create-folder, move and rename operations for review. The model never receives the native root path. Approval permits only the listed operations within that grant; no overwrite, deletion, shell or directory moves. The shared proposal panel restores the original grant after restart; unavailable access keeps Approve disabled and displays readable recovery guidance. Proposals, verified effects and undo remain visibly distinct. Receipts show source → destination and each operation's result; stop/resume and verified undo use the persistent device journal. The root Agents collection and UI-only workflow/template/integration catalogs retain their previous scope.

## Phase 4 reusable work — October 3

Workflows, templates and skills now use account-owned, server-persisted immutable versions. The existing catalog layout remains the launch surface. A workflow asks its typed questions before an explicit Run; it enters the existing invocation and conversation lifecycle. A saved template renders its questions into an unsent draft. Skills are editable guidance applied to new work, with up to eight enabled for an agent; they do not expand tool permissions.

The shared method editor supports successful-task provenance without copying its private output. Version conflicts preserve the draft and ask the owner to reload. Workflow schedules use the existing Scheduled page and pin their version and input values; later method edits never silently change a schedule. The catalog exposes pause, resume, removal and opening the scheduled task. Browser-target schedules explicitly disclose that unattended device execution is unavailable. The current-window and separate-window controls use the phase 3 native execution path; ordinary cloud methods use connected apps and supplied context.
