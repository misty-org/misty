# Misty agent architecture and implementation plan

> **Superseded in part (October 4, 2026):** [agent-architecture/BRIEF.md](../agent-architecture/BRIEF.md) replaces this plan's enforced capability allowlist, up-front work-location choice, single-tool Composio scope and single-step Midscene planner. Its security invariants still apply.

Status: phases 1–4 implementation is present, October 3, 2026. Phases 1–2 have live owner acceptance. Phase 4 manual and scheduled version-pinned workflows have live evidence. Composio Cloud Calendar authorization and a real adapter read have passed; phase 3 combined agent/browser/voice acceptance is being completed. The owner moved OAuth branding verification to a separate production-launch checklist. Phases 4a, 5 and 6 remain out of scope.

Misty should be one useful personal agent that can work through its own browser window, organize authorized files, use connected accounts, and explain verified results. The Agents page, Cmd+Shift+K panel, and Talk to Companion are entry points to the same agent and durable conversation. After individual-agent work is proven, agents can exchange messages within a shared Space and teach each other user-authorized methods.

## Goal and release order

The first engineering goal is to complete an authorized task from any entry point, preserve its identity when the user changes surfaces, execute through native Misty tools, a browser, or a selected Composio connection, and deliver a result whose effects can be inspected. The agent must survive UI closure, reconnect safely, and stop device control on request.

The later collaboration goal is: “Hey Misty, show Melissa’s agent how we organize files.” Misty identifies the intended collaborator, shares an approved organizational method, answers questions autonomously within that exchange, and lets Melissa’s agent propose a local adaptation. Each agent retains its own owner, accounts, permissions, and memory.

Release order is binding for this plan: shared agent lifecycle, verified individual work, reusable workflows, then cross-member messaging and teaching. Collaboration cannot be enabled merely because its interface exists.

## Product decisions

- Keep the current Agents directory and approved per-agent layout. Integrations manages account connections and this agent’s tool access. Instructions and skills ultimately belong with Agent settings. Catalog examples must not imply working connections.
- Agents belong to accounts. Spaces are optional context and, later, the boundary for discovering collaborators. An agent does not need a Space to work.
- Misty companion is a presentation and voice mode of an agent. It is not a separate identity or execution engine. Existing bot or installed-agent identities should resolve to the same profile and invocation contract where they represent the same actor; do not collapse distinct owners or permissions.
- Retain floating interaction. A task may open an agent-owned Misty browser window; do not require a permanent conversation/browser split.
- Prefer structured Misty actions or connected API tools when available. Use observed browser interaction for work that requires the website. Report the actual execution path; do not animate fictitious typing for an API call.
- Keep shared components and monochrome chrome, focus, status, and control indicators. Respect reduced motion. Settings remain server-account preferences; device identity and local vault secrets remain distinct.

## One conversation across three surfaces

| Surface | Purpose | Required behavior |
| --- | --- | --- |
| Agents workspace | Start, review, configure, and revisit work | Owns no separate runtime. Displays the selected agent’s conversations, runs, artifacts, questions, and approvals. |
| Cmd+Shift+K panel | Ask or steer from the current window | Opens the explicitly associated conversation when there is one; otherwise resumes the last compatible conversation for the selected agent and account. Shows its title and a clear New task action. Opening the panel never submits work or starts the microphone. |
| Talk to Companion | Speak to the same agent | Resumes that conversation in a persistent realtime session; ordinary conversation responds directly, while task requests bridge into the same authenticated command path. Dictation in a composer remains a draft; Talk sends on the existing explicit commit gesture. |
| Floating companion | Follow work while using Misty | Shows the same run and intervention state, with access to the full conversation. Hiding it is not canceling the task. |

An explicit conversation selection wins over ambient active state. Agent or account switches cannot silently reuse another actor’s draft, context, voice session, or run. Opening a panel must not destroy an unsent draft in another surface. Drafts and attachments need an explicit handoff, while durable messages and run events are shared.

Context is attached visibly to a request: selected items, an explicitly attached Space, a browser target, or the requested screen. Surface switching does not silently broaden context or authorize screen capture. Preserve existing explicit voice capture behavior and make its attached target visible.

One active execution per conversation is the initial rule. During execution, a follow-up is durably queued as steering and acknowledged at the next safe boundary. Pause prevents the next action; Stop requests cancellation and revokes device control immediately. Already dispatched external effects may still complete and must be reconciled. New task can create another run, but exclusive control of a particular window or screen cannot be shared.

Voice transport has its own lifecycle. Listening, transcribing, and speaking are not run states. The voice model answers ordinary conversation directly and requests bounded context/task tools through the existing authority boundary. Task-result narration comes from the persisted backend answer. Both are saved in the same conversation. Stopping playback or retrying speech does not stop or repeat business actions. Explicit Stop task cancels execution. Short progress announcements, if added, must derive from actual run events.

## Architecture and ownership

The Vercel AI SDK runtime plans and invokes tools. Misty’s Go services remain authoritative for identity, account and Space access, task admission, durable run records, approvals, scheduling, and audit. Native device workers execute browser and filesystem operations with bounded grants. Composio supplies selected external tools and connected-account authentication.

Use one Misty tool registry and execution policy across native tools, Composio adapters, and external MCP connections. Normalize input/output schemas, effects, permission requirements, execution location, and receipts. Dynamic discovery may reveal only allowed tools. A tool declaration or model-generated plan never grants authority.

The model can choose the next permitted action and ask for missing information. The server validates tool arguments and authorization on every call. Retrieved pages, files, emails, and agent replies are evidence, not authority to widen a task.

### Proposed durable records

These are logical contracts to map onto existing tables before adding migrations. They are not a request to build parallel versions of records Misty already has.

| Record | Essential fields and role |
| --- | --- |
| AgentProfile and version | Owner, identity, instructions, model policy, enabled tools, skill versions, memory policy. Capture the effective version for each run. |
| Conversation and Message | Account, agent, ordered messages, authorship, input modality, attachment references. Surface/window identity is not conversation identity. |
| AgentRun | Conversation, initiating message, owner, agent version, optional workflow version, status, execution target, limits, result references, parent run, timestamps. |
| ContextBinding | Resource type and ID, permitted operation, originating request, optional Space ID, version or fingerprint where useful. Revalidate access when used. |
| CapabilityGrant | Owner, agent, capability/version, resource scope, permitted request origins, approval policy, limits, expiry, and revocation revision. References real resource IDs or device grants rather than arbitrary model-supplied paths. |
| RunEvent and ToolExecution | Run ID, sequence, tool call ID, operation identity, state, observed result, artifact references, error, and retry disposition. Support event replay without repeating effects. |
| Intervention | A question, approval, connection requirement, or device handoff tied to one run and proposed operation. Store the decision and its exact scope. |
| BrowserSession and ControlLease | Run, device, native window/tabs, authorized browser session, controller, lease expiry, takeover state. Browser credentials stay with the device. |
| IntegrationConnection and AgentBinding | Owner, provider, external connection ID, health, allowed capabilities/resources, credential reference. No secrets in prompts or workflow JSON. |
| ComposioSessionBinding | Run or compatible conversation, stable server-derived user identity, provider session ID, selected accounts, allowed tools, policy revision, expiry/revocation metadata. |
| WorkflowVersion and Trigger | Typed inputs/outputs, steps, bounded AI tasks, capability requirements, dependencies, schedule, and explicit execution target. Pin versions for runs. |
| TemplateVersion and SkillVersion | Templates seed drafts; skills hold reusable guidance and examples. Neither grants access. Store origin, version, ownership, and sharing visibility. |

Choose one canonical run/event model after auditing the existing AIInvocation, personal run, and SpaceRun paths. Use adapters and additive migrations to preserve historical conversations, scheduling, billing, and active runs. Do not globally rename or remove required Space fields without a compatibility migration.

Conceptual run states are queued, running, waiting for input, waiting for approval, waiting for connection, waiting for device, paused, cancelling, completed, partially completed, failed, and cancelled. Map these to existing states before extending the schema. A run can finish with verified partial results. A submitted click is not proof that a business action succeeded.

## Capabilities and execution boundaries

Prioritize a working individual agent. Build the complete capabilities settings page, permission explanations, and broader security review after the first functional implementation. Include a small enforced allowlist in the initial executor: delaying the controls UI is acceptable; temporarily granting unrestricted execution is not part of this plan. Reuse the existing capability registry and authorization boundary instead of building a separate security framework first.

A capability is an executable permission with a resource scope, not just a label shown to the model. The agent may act autonomously within its owner's grant and the current task. It does not need a confirmation for every file move or research click already covered by that grant. Missing access produces a specific request or a denied operation, not a broad “allow everything” prompt.

### Initial capability list

The names below are proposed logical permissions to map to the existing registry before implementation.

| Capability | Scope and launch behavior |
| --- | --- |
| Read knowledge | Selected collections, documents, or Space resources; existing account and membership permissions still apply. |
| Read files | An explicitly selected folder or file set on the authorized device. No implicit access to the entire drive. |
| Organize files | Create folders, move, and rename within approved source and destination roots. Does not include overwriting, deleting, or changing permissions. |
| Trash files | Separate permission for named files or a bounded batch; excluded from the initial organization task and from requests initiated by another agent. |
| Operate browser | Assigned window/tabs and intended browser identity. Website actions retain their read, write, send, or destructive classification. |
| Use integration | Selected connection, operations, and resource scope, such as reading one calendar. Connecting a provider does not enable all its tools. |
| Send or publish | Explicit destinations and content scope; separate from drafting or reading. Can be authorized for a bounded task without repeated confirmations. |
| Message agents | Named participants or owner-approved agents in a shared Space, within an authorized exchange and its limits. |
| Share a method | Approved skill/workflow content and examples; does not grant access to underlying private files or accounts. |
| Execute shell or unrestricted code | Unavailable in the initial product. Any future isolated computation needs a separate design and cannot inherit host filesystem or credentials. |
| Erase drives, destroy system folders, export secrets, or change agent security policy | Not exposed as agent capabilities. Root-drive deletion and equivalent destructive system actions are prohibited, including indirect execution routes. |

### Incoming messages cannot grant authority

“Another agent asked” is a distinct request origin. A message, downloaded skill, or claimed instruction from its owner cannot impersonate a direct instruction from the receiving agent's owner. Receiving, discussing, and learning a method do not authorize applying it to local files.

Effective access is the intersection of the owner's resource permissions, the receiving agent's capability grants, the current task or standing collaboration grant, and any operation-specific approval. Delegation can narrow that intersection but cannot enlarge it. The sender's grants and credentials never transfer. Initial cross-agent exchanges allow discussion and approved method sharing; local file mutation requires the recipient owner's independent grant for that purpose. File deletion is not an allowed cross-agent operation at launch.

For example, Melissa's agent may ask how invoices are classified and receive the approved rule. If it says “delete your root drive,” Misty denies the operation at execution, records why, and does not convert the message into a user approval request or a new privileged task. Even an agent otherwise allowed to organize Downloads cannot reinterpret that grant as deletion access.

### Enforcement and usability

The server checks every operation, including operations hidden inside batch, proxy, or discovered tools. The device worker also validates its target and grant before native effects. Filesystem containment uses resolved targets and safe handling of links and path races; a string prefix check is insufficient. Grants are revocable and checked again when work resumes.

An unrestricted terminal, privileged app, provider proxy, or browser action must not become an alternate route around a denied capability. Launch only those execution modes for which the boundary can be enforced. Prompt instructions and a model's risk judgment alone do not satisfy this gate.

After the useful-agent demonstration, add an Agent settings capabilities list grouped by knowledge, files, browser, integrations, and collaboration. Each entry shows the allowed action, actual resource scope, and whether it is allowed, requires approval, or is unavailable. Use the existing settings components and account model; do not add a separate navigation system. Integrations retains connection setup and links to the relevant agent permissions.

Before enabling live cross-member collaboration, verify denial of root-drive deletion, out-of-folder writes, link escapes, secret access, tool/proxy bypasses, sender impersonation, permission escalation through a shared skill, and execution after revocation. These checks complement successful task demonstrations; they do not replace them.

## Composio and Misty MCP

### Approved Cloud deployment — October 3, 2026

The owner explicitly selected Composio Cloud after evaluating self-hosting and
alternatives. This supersedes the original self-host-only prerequisite. The owner subsequently moved OAuth branding verification to a separate production-launch checklist; it no longer blocks functional phase 3–4 acceptance. Misty must
retain its branding and its existing Vercel AI SDK runtime, ownership model,
capability checks and execution journal. Cloud mode must be explicitly configured;
there is no automatic fallback between an operator instance and Cloud.

Use the existing dashboard project key on the server, a custom Google Calendar
OAuth app branded as Misty, and a pinned read-only Calendar tool version. The first
acceptance gate is a real owner-authorized connection and scoped tool call with a
provider receipt, followed by refresh, revocation/recovery and the combined research
demonstration. Cloud processes integration data and stores/refreshes provider tokens.
Enterprise distribution, infrastructure provisioning and Helm are no longer blockers.
See [Cloud setup](../../../server/deploy/composio/README.md).

### Runtime integration

Start with one external integration and explicitly selected tools. Keep the Composio project key on the server. Derive its user identity from authenticated Misty ownership, select the intended connected account, and bind the session to the permitted task. Do not use a Space ID as a shared identity for all members’ personal connections.

Wrap Composio execution in Misty’s operation journal and approval path. Establish how individual effects inside search, batch, or proxy tools are authorized before enabling them; broad execution wrappers must not bypass per-operation policy. Reconstruct SDK clients inside durable execution steps rather than attempting to serialize live client closures. Compatibility testing must cover schema conversion, errors, cancellation, replay, and unknown outcomes.

Misty tools remain directly accessible through our existing MCP/runtime boundary. Extend discovery with concise product guidance and live, permission-checked tools for describing Spaces, searching knowledge, reading artifacts, and performing structured changes. Keep instructions about how Misty works separate from private content retrieved for a task.

Registering a public Misty MCP toolkit with Composio is optional and later. Their custom MCP feature is experimental and requires a public HTTPS endpoint with suitable authentication. The current internal run-scoped endpoint needs a deliberate external-client authentication design before that route is used.

Composio OAuth and browser login are separate. The UI must identify the account used for an external tool and the browser session used for website work. OAuth authorization does not import cookies or log a site into the agent window. Browser automation pauses for required user sign-in or verification.

## Individual work acceptance tasks

### Organize a selected folder

The first supported scope is a user-selected test folder, followed by an explicitly granted real folder. Cloud file providers and whole-library organization are later expansions of the same contract.

Inspect files and existing conventions; produce an organization proposal with proposed moves/renames, collisions, and unresolved items. Apply approved operations using stable file identity or freshness checks, retain a manifest of before/after locations, and verify each effect. Do not delete files as part of ordinary organization. Offer undo only for operations whose inverse can be performed safely; changed or externally moved items require reconciliation.

Acceptance includes duplicate filenames, nested directories, inaccessible files, interrupted execution, files changed after planning, and a rerun that does not duplicate completed work. The user can inspect the resulting folder and operation manifest. A text summary alone does not pass.

### Research with a connected account

From either the panel or Agents page, ask for a brief that combines website research with one authorized integration. Open a separate agent-owned browser window, inspect real sources, use the selected external account, and save a cited artifact in Misty. The user can take over the window and resume the same task after the agent re-inspects its state.

Repeat through Talk to Companion. The spoken conclusion must match the saved artifact and actual execution receipts. The main user window must remain untouched in separate-window mode. Verify that changing windows or losing the microphone cannot redirect the operation to another account or target.

## Phases and readiness gates

Phases 1 and 2 are implemented on the current branch. Shared text/popup execution and selected-folder apply, restart recovery and undo have live desktop evidence; automated tests cover voice handoff, steering and isolation. The user confirmed the phase 1 live microphone/speaker handoff and subsequently accepted the persistent realtime latency and speech continuity fix. Phase 2 selected-folder acceptance passed on macOS. Phase 3 browser and phase 4 reusable-work implementation are now present; Composio Cloud configuration, owner consent and real provider adapter calls have passed. Remaining acceptance covers the combined browser/Calendar task, ordinary Resume and verified voice narration; branding is a separate production-launch gate. See [phase 3–4 execution evidence](PHASES-3-4.md) and [implementation evidence and limits](IMPLEMENTATION.md#phases-1-and-2-shared-lifecycle-and-verified-folder-work). Do not enable the next dependent phase while its gate is unmet.

| Phase | Deliverables | Gate |
| --- | --- | --- |
| 0 Architecture review | Resolve the contracts in this plan, map existing storage/runtime paths, select canonical records, record migration and test boundaries | Reviewed baseline and a bounded first implementation slice. No backend work in the planning turn. |
| 1 Shared lifecycle | Shared admission and run identity; panel/workspace/voice handoff; event replay; separate audio controls; context and account isolation | Start by typing, continue by voice, reopen in the other surface, and inspect one conversation without duplicate execution or lost attachments. |
| 2 Verified Misty work | Permission-checked knowledge/file tools; organization proposal, operation manifest, recovery and result verification | Selected-folder acceptance passes against disposable files, including collision, stale data, cancellation, and replay cases. |
| 3 Browser and Composio | Verified Composio Cloud connection, agent-owned window, target lease, takeover, one scoped integration, common execution events | Cloud setup passes (branding has a separate production-launch gate); research acceptance passes through text and real microphone/speaker paths; account isolation and device reconnection pass. |
| 4 Reusable work | Save successful methods as skills/workflows, typed input questions, template instantiation, existing scheduler integration | A version-pinned workflow succeeds manually and on schedule; unavailable devices/connections produce truthful waits or failures; retries do not repeat effects. |
| 4a Capabilities controls and security review | User-facing capabilities list, scope editing/revocation, clear denial explanations, and adversarial checks across tools and device boundaries | Useful individual-agent tasks still pass; capability bypass and destructive incoming-agent requests are denied by executors before live cross-member access is enabled. |
| 5 Agent conversations | Same-Space agent discovery, owner opt-in, durable exchange, bounded autonomous replies, inspectable history | Two test owners exchange a task and follow-up questions without sharing private context or credentials; revocation, duplicate delivery, and loop limits pass. |
| 6 Teaching methods | Extract, preview, share, adapt, and version a reusable method | The Melissa demonstration passes using sanitized examples and her own authorized destination; acceptance by her agent follows her configured policy. |

Phases 1–3 establish the useful individual agent with minimal enforced grants. Phase 4a supplies the fuller capabilities controls and security review after functional implementation. Phases 5–6 remain disabled until those gates pass and phase 4 provides the reusable method model. No marketplace, public agent network, always-listening behavior, or unrestricted computer control is required for this goal.

## Agent conversations after individual work is proven

Use durable messages, so agents can ask questions and answer naturally over time. Delegated jobs are optional outcomes of a conversation, not the only way agents interact.

An AgentPublication makes an owner’s agent discoverable within a particular Space and declares its capabilities and response policy. An AgentExchange records participants, purpose, permitted context, status, expiry, turn budget, and parent user request. Each AgentMessage records sender, reply relationship, delivery identity, content/artifact references, and a sequence. The recipient executes a separate run under its own owner; it receives no sender credentials or private memory by implication.

Both owners must have allowed this collaboration. Within that policy, an agent can send relevant messages and autonomously reply to the ongoing exchange without a confirmation for every sentence. The initiating user request supplies the exchange purpose. New recipients, unrelated purposes, or effects beyond the agreed policy require a new decision. Shared Space membership permits discovery, not access to another member’s personal accounts.

Initial limits are configurable server policy with conservative launch defaults: at most 12 agent-authored messages per exchange, a 30-minute execution deadline, and no onward delegation. Budget exhaustion asks the user whether to continue. Do not expire a human approval merely because an active-execution timer elapsed; define wait accounting separately. Stop propagates to descendant work, membership and grants are rechecked at execution/delivery, and duplicate delivery cannot create duplicate replies.

Show participants and useful exchange milestones in the original conversation. Users can inspect the full exchange, stop it, and revoke future collaboration. Agents should not emit endless acknowledgements or unsolicited social chatter. Future recurring collaboration would need an explicit standing purpose and schedule.

## Teaching Melissa our file organization

1. Resolve Melissa and the agent she has made available in the shared Space. Ask only if the target is ambiguous or unavailable.
2. Derive a proposed method from the approved file-organization plan and verified results: taxonomy, naming rules, classification criteria, exclusions, collision handling, and examples.
3. Build a TeachingPackage containing a versioned skill or workflow reference, sanitized examples, expected outcomes, prerequisites, and provenance. Private filenames, document contents, local paths, secrets, and broad access grants are excluded unless specifically authorized.
4. Preview the package and intended recipient. The request authorizes teaching the method; clarify any additional private material needed before sending it. Reuse an already approved sharing scope rather than asking repeatedly.
5. Send the package in an AgentExchange. Melissa’s agent can ask how ambiguous files are treated or propose mappings to Melissa’s folders, and Misty can answer from the approved package and exchange context.
6. Melissa’s agent stores the method as a received proposal. Its owner’s configured policy determines acceptance and whether a dry run is permitted. Execution on Melissa’s real files requires her own grants and operation policy.
7. Return a receipt distinguishing delivered, understood/questions answered, accepted, and applied. Never report “Melissa’s files are organized” merely because her agent received instructions.

The teaching artifact should be portable know-how. It must not be a replay of private files or a grant to operate another user’s computer.

## Validation and implementation discipline

Record evidence for: one-run handoff across surfaces; account/agent switching; duplicate submission; event reconnect; app restart and native target restoration; device loss; connection revocation; pause/stop/takeover; uncertain external effects; file collision/undo; speech retry; and completed-artifact verification. Cross-agent tests additionally cover membership loss, denied sharing, malicious received content, reply loops, and budget expiry.

Use unit tests for policy/state transitions, contract tests for execution and provider adapters, and integration tests with disposable files and separate test accounts. Native window, microphone, speaker, browser-login, and takeover behavior require an actual desktop demonstration. Mocks and UI screenshots do not prove those capabilities.

Keep billing and usage tied to existing durable execution identities. Speech playback and retries must not duplicate tool or model charges. Reuse the existing scheduler and native audio architecture; do not introduce competing loops as a shortcut.

Start each implementation phase with an evidence-based gap audit. Preserve working primitives, keep unrelated changes intact, and make required backend migrations additive and reviewable. No separate backend, provider installation, credential connection, or live account action is part of this planning deliverable.

## Current evidence and remaining decisions

Repository inspection establishes foundations, not end-to-end acceptance:

- [AgentWorkspaceConversation](../../../src/features/agents/components/AgentWorkspaceConversation.tsx) already routes desktop submissions through the companion bridge; [companionState](../../../src/features/agents/companion/companionState.ts) explicitly shares its controller with the Agents page.
- [Shortcut registry](../../../src/features/shortcuts/registry.ts) maps Cmd+Shift+K to Open Misty. [WorkspaceCanvas](../../../src/app/layouts/DesktopLayout/WorkspaceCanvas.tsx) dispatches it through openMisty.
- [Native audio plan](../../plans/companion-native-audio.md) documents persistent realtime conversation, bounded task delegation, on-demand screen context and saved-result narration. Preserve its accounting and lifecycle guarantees.
- [Misty MCP](../../../server/internal/platform/httpapi/misty_mcp_server.go), [browser tools](../../../server/internal/platform/httpapi/agent_toolbox_catalog.go), and [device execution](../../../server/internal/platform/httpapi/browser_agent_tools.go) are existing boundaries to extend.
- [Workflow contracts](../../../server/internal/workflows/contracts.go), [scheduled tasks](../../../src/api/scheduled/api.ts), and [personal runs](../../../src/features/agents/model/interfaces/personal.ts) provide existing structures, including legacy Space-shaped fields that need compatibility treatment.
- [Runtime delegation](../../../server/internal/platform/httpapi/agent_runtime_tool_execution.go) contains a same-agent child-run path. It is not evidence of complete cross-owner agent messaging.

Implementation must settle the canonical storage mapping, native browser profile/window mechanics, first Composio toolkit/auth scopes, provider retention/cost requirements, and exact capability coverage of each file provider. Proposed first integration is Calendar read access for the research demonstration; the product contract does not depend on that vendor choice. These are phase-specific engineering decisions, not reasons to expand the current planning scope.

Composio references inspected during this discussion: [Vercel adapter](https://docs.composio.dev/docs/providers/vercel), [session configuration](https://docs.composio.dev/docs/configuring-sessions), [experimental custom MCP](https://docs.composio.dev/docs/extending-sessions/custom-mcp), and [SDK repository](https://github.com/ComposioHQ/composio). The repository is MIT-licensed SDK code. Misty's current approved deployment is Composio Cloud, subject to the branding and real-account acceptance prerequisite above. Verify compatible releases and feature parity when implementation begins.

## Execution checklist

- [x] Record user goals, surface behavior, architecture proposal, staged gates, and teaching scenario.
- [x] Architecture direction accepted; requested capabilities section added.
- [x] Phase 1 shared lifecycle implemented and automated verification passed.
- [x] Phase 1 live typed → spoken → reopened conversation handoff confirmed by the user (real microphone/speaker).
- [x] Voice performance follow-up: persistent realtime conversation implemented; user confirmed fast, smooth physical microphone/speaker playback. Server first-audio measurements are approximately 0.9–1.4 seconds after commit.
- [x] Phase 2 selected-folder organization implemented and verified on macOS with disposable files, including apply/restart/undo, collision, stale-source and interruption tests.
- [x] Owner selected Composio Cloud, superseding Enterprise self-hosting; explicit Cloud configuration and operator runbook implemented.
- [x] Custom Calendar OAuth configuration, owner consent, per-agent read grant and real provider adapter receipt verified.
- [ ] Phase 3 browser and integration work accepted.
- [x] Phase 4 reusable methods implemented; typed input, version-pinned manual and scheduled execution verified in the real desktop/runtime.
- [ ] Owner review of phase 3–4 behavior and connected-account demonstration completed.
- [ ] Phase 4a capabilities controls and security review accepted.
- [ ] Phase 5 autonomous agent exchange accepted.
- [ ] Phase 6 teaching demonstration accepted.

Current gate: finish physical microphone/speaker narration and the remaining live browser reliability checks. The October 3 evening continuation exercised the actual browser/Calendar loop, ordinary takeover and Resume in the same conversation, and saved-note delivery/readback after repairing a projection defect. These results do not yet accept all of phase 3: the fresh drawing/voice-lifecycle replay and worker follow-up routing remain unverified. Phase 4a and cross-agent phases remain disabled. See [the execution record](PHASES-3-4.md) for implemented behavior, tests, and explicit limitations.

## Production-launch branding checklist

Moved outside functional phase 3–4 acceptance by the owner on October 3, 2026.

- [ ] Configure and verify Misty’s name, logo, website and privacy policy in Google Auth Platform.
- [ ] Configure Misty’s Composio Connect Link name/logo and verify welcome and success screens.
- [ ] Decide whether redirect-domain branding requires a Misty-owned callback relay; if so, deploy and verify it before changing OAuth configuration.
- [ ] Verify production OAuth scopes, consent, token refresh and revocation with the production project.
