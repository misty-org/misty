# Native personal agents

Agents are part of the Misty host. A Space installs apps; a person assigns some of those apps to an agent. The same profile can have different assignments in each Space. A responsibility describes how the agent should work; it does not schedule recurring work.

Apps do not embed an agent runtime. Use `misty.ai.open({ agentId, prompt })` to open a conversation with an existing personal agent. Omit `agentId` for the user's default Misty identity. The host owns profile management and execution activation; app RPC cannot activate Agent or Team mode or grant assignments.

## Configured website destinations

Publish the complete current destination list whenever configured accounts change:

```ts
await misty.browser.setDestinations([
  {
    provider: { id: "instagram", accountId: "brand-account" },
    label: "Brand Instagram",
    url: "https://www.instagram.com/",
  },
]);
```

The host supplies the app, account and Space identity from the app's mounted scope and validates provider ownership and URL boundaries. Account IDs are existing app-local browser profile identities, never credentials. Publish an empty list when the last account is removed. Destinations remain discoverable when the integration page is closed. This operation does not assign the app to an agent or grant permission to execute.

Older hosts may return `unsupported_method`; retain normal app behavior in that case. Older stored website accounts are discovered through a bounded host migration adapter until the app publishes its first destination list. Never change account IDs merely to adopt registration: the existing profile identifies the user's cookies and login session.

## Modes and browser interaction

User mode permits reading assigned context, conversation drafts, and explicit profile and memory management. Agent mode controls the main work surface. Team mode uses independent native windows with the same integration profiles. Only the user activates an execution mode. Assignments and task authority are checked outside the model, including again at device dispatch. Configuration writes are unavailable to an executing task; switch to User mode to change assignments conversationally.

Browser contracts support macOS and Windows. Semantic actions consume a fresh inspected `documentId`. The `point` interaction uses coordinates normalized from 0 to 1 within the inspected viewport; re-inspect after navigation or an interaction. Visual inspection and task-file upload are host execution tools, not arbitrary JavaScript or filesystem access supplied to integration pages.

Task uploads resolve attachment IDs in the host against the invoking conversation. An input accepting a file does not prove that the website finished uploading it. Downloads are ready only after native completion reports an existing file. Agents must inspect results and report partial or uncertain outcomes; they must not retry uncertain sends or uploads as if nothing happened.

## Compatibility and privacy

`AgentProfile`, `AgentAppAssignments`, `AgentTaskContext`, and `AgentTaskArtifact` are shared contracts. Conversations, memory and activity remain private to their owner and agent even in shared Spaces. Space memory does not become global profile instructions. Legacy invocations without `agent_id` resolve to default Misty. Existing conversations and attachment records are retained by additive migration.

The downloadable Agents transport remains for older clients and is deprecated for new code. New hosts redirect legacy Agents routes to the native destination and do not require its package. Schedules, cloud execution, automatic agent handoffs and new shared-agent semantics are outside this release.
