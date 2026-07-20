import {
  createWorkflowNode,
  workflowNodeRegistry,
  type WorkflowCapabilityRequirement,
  type WorkflowDefinitionV2,
  type WorkflowEdgeV2,
  type WorkflowNodeKind,
  type WorkflowNodeV2,
} from "./v2";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinitionV2;
}

export const workflowTemplates: readonly WorkflowTemplate[] = [
  template(
    "new-file-summaries",
    "New file summaries",
    "Summarize new files into .summaries and send a private digest.",
    [
      "file_changes",
      "changed_files",
      "for_each",
      "read_content",
      "agent_task",
      "create_document",
      "notify_private",
    ],
  ),
  template(
    "project-change-digest",
    "Project change digest",
    "Explain changed project files, flag risks, and produce a private report.",
    ["cron_trigger", "changed_files", "for_each", "read_content", "agent_task", "notify_private"],
  ),
  template(
    "unread-message-brief",
    "Unread message brief",
    "Batch unread connector messages, summarize them, and optionally reply.",
    ["connector_trigger", "debounce", "for_each", "agent_task", "post_reply", "notify_private"],
  ),
  template(
    "chat-catch-up",
    "Chat catch-up",
    "Summarize unread mentions, decisions, and unanswered questions.",
    ["message_trigger", "debounce", "agent_task", "notify_private"],
  ),
  template(
    "research-intake",
    "Research intake",
    "Read new Library evidence, cite it, and update a living brief.",
    [
      "library_changes",
      "for_each",
      "read_content",
      "agent_task",
      "write_library_artifact",
      "update_metadata",
      "notify_private",
    ],
  ),
  template(
    "meeting-follow-up",
    "Meeting follow-up",
    "Gather meeting context, produce notes, and draft follow-ups.",
    [
      "connector_trigger",
      "source_query",
      "for_each",
      "read_content",
      "agent_task",
      "write_library_artifact",
      "post_reply",
      "notify_private",
    ],
  ),
  template(
    "invoice-intake",
    "Invoice and receipt intake",
    "Extract structured fields and flag duplicates or anomalies.",
    [
      "library_changes",
      "for_each",
      "read_content",
      "agent_task",
      "write_library_artifact",
      "notify_private",
    ],
  ),
  template(
    "contract-review",
    "Contract review",
    "Extract deadlines and risky clauses into a cited review.",
    ["manual_trigger", "read_content", "agent_task", "write_library_artifact", "notify_private"],
  ),
  template(
    "support-triage",
    "Support triage",
    "Classify support messages, gather context, and draft replies.",
    ["connector_trigger", "for_each", "source_query", "agent_task", "post_reply", "notify_private"],
  ),
  template(
    "meeting-brief",
    "Account meeting brief",
    "Combine recent messages, documents, and calendar events.",
    ["cron_trigger", "source_query", "for_each", "read_content", "agent_task", "notify_private"],
  ),
  template(
    "downloads-cleanup",
    "Downloads cleanup",
    "Classify downloads and propose safe organization actions.",
    ["file_changes", "changed_files", "for_each", "agent_task", "exact_tool", "notify_private"],
  ),
  template(
    "project-status",
    "Project status digest",
    "Combine Library, chat, and connector changes into a scheduled update.",
    ["cron_trigger", "source_query", "for_each", "read_content", "agent_task", "notify_private"],
  ),
] as const;

function template(
  id: string,
  name: string,
  description: string,
  kinds: WorkflowNodeKind[],
): WorkflowTemplate {
  const loopIndex = kinds.indexOf("for_each");
  let rootKinds = kinds;
  let childGraph: WorkflowDefinitionV2 | null = null;
  if (loopIndex >= 0) {
    const notifyIndex = kinds.indexOf("notify_private", loopIndex + 1);
    const childEnd = notifyIndex >= 0 ? notifyIndex : kinds.length;
    const childKinds = kinds.slice(loopIndex + 1, childEnd);
    rootKinds = [...kinds.slice(0, loopIndex + 1), ...kinds.slice(childEnd)];
    childGraph = graph(id, childKinds, "item");
  }
  const { nodes, edges } = graphParts(id, rootKinds, "root");
  const loop = nodes.find((node) => node.kind === "for_each");
  if (loop && childGraph)
    loop.config = { concurrency: 4, maximumItems: 1000, errorMode: "collect", childGraph };
  const loopPosition = nodes.findIndex((node) => node.kind === "for_each");
  if (loopPosition >= 0 && nodes[loopPosition + 1])
    nodes[loopPosition + 1].errors.acceptsPartial = true;
  const envelope = capabilityEnvelope([...nodes, ...(childGraph?.nodes ?? [])]);
  return {
    id,
    name,
    description,
    definition: {
      formatVersion: 2,
      inputs: { type: "object" },
      outputs: { type: "object" },
      capabilities: envelope,
      nodes,
      edges,
      dependencies: [],
    },
  };
}

function graph(templateId: string, kinds: WorkflowNodeKind[], scope: string): WorkflowDefinitionV2 {
  const { nodes, edges } = graphParts(templateId, kinds, scope);
  const capabilities = capabilityEnvelope(nodes);
  return {
    formatVersion: 2,
    inputs: { type: "object" },
    outputs: { type: "object" },
    capabilities,
    nodes,
    edges,
    dependencies: [],
  };
}

function capabilityEnvelope(nodes: WorkflowNodeV2[]): WorkflowCapabilityRequirement[] {
  const capabilities = new Map<string, WorkflowCapabilityRequirement>();
  for (const node of nodes) {
    const entry = workflowNodeRegistry.find((candidate) => candidate.kind === node.kind)!;
    capabilities.set(entry.capability, { capability: entry.capability, risk: entry.risk });
  }
  return [...capabilities.values()];
}

function graphParts(
  templateId: string,
  kinds: WorkflowNodeKind[],
  scope: string,
): { nodes: ReturnType<typeof createWorkflowNode>[]; edges: WorkflowEdgeV2[] } {
  const nodes = kinds.map((kind, index) => {
    const node = createWorkflowNode(kind, { x: 80 + index * 220, y: 120 });
    node.id = `${templateId}_${scope}_${kind}_${index + 1}`;
    node.config = { ...node.config, ...templateNodeConfig(templateId, kind) };
    return node;
  });
  const edges = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index].id}:${node.id}`,
    source: nodes[index].id,
    sourcePort: "output",
    target: node.id,
    targetPort: "input",
  }));
  return { nodes, edges };
}

function taskInstruction(templateId: string): string {
  const instructions: Record<string, string> = {
    "new-file-summaries":
      "Summarize this file faithfully, preserve important dates and decisions, and return markdown with source citations.",
    "project-change-digest":
      "Explain what changed, why it may matter, and flag correctness, security, migration, and compatibility risks with citations.",
    "unread-message-brief":
      "Summarize this unread conversation, extract owners and action items, and draft a concise reply only when a response is useful.",
    "chat-catch-up":
      "Summarize decisions, assigned actions, open questions, and mentions that still need the user’s attention.",
    "research-intake":
      "Summarize this evidence, extract grounded tags, and propose a cited addition to the living research brief.",
    "meeting-follow-up":
      "Create factual meeting notes, decisions, action items with owners and dates, and a clearly marked draft follow-up.",
    "invoice-intake":
      "Extract supplier, invoice number, dates, currency, subtotal, tax, total, and line items; flag duplicates and anomalies without guessing.",
    "contract-review":
      "Extract deadlines, renewal and termination terms, obligations, and risky clauses with precise citations; this is issue spotting, not legal advice.",
    "support-triage":
      "Classify urgency and topic, ground the answer in available evidence, draft a reply, and escalate security, safety, billing, or legal risk.",
    "meeting-brief":
      "Produce a private pre-meeting brief with participants, recent context, unresolved issues, goals, and cited source links.",
    "downloads-cleanup":
      "Classify this item and propose a destination. Never move, overwrite, or delete it without the workflow’s explicit approved action.",
    "project-status":
      "Summarize progress, decisions, blockers, risks, owners, and next steps across the supplied project evidence with citations.",
  };
  return (
    instructions[templateId] ?? "Complete this step with grounded, cited, schema-valid output."
  );
}

function templateNodeConfig(templateId: string, kind: WorkflowNodeKind): Record<string, unknown> {
  switch (kind) {
    case "cron_trigger":
      return {
        expression: templateId === "meeting-brief" ? "0 8 * * 1-5" : "0 17 * * 1-5",
        timezone: "UTC",
        missedRunPolicy: "coalesce",
      };
    case "file_changes":
      return {
        include: ["**/*"],
        exclude: [".summaries/**", "**/.summaries/**"],
        ignoreProvenance: ["workflow_generated"],
      };
    case "changed_files":
      return { excludeGenerated: true, claimMode: "atomic", fingerprintRequired: true };
    case "connector_trigger":
      return {
        capabilityId: templateId.includes("meeting")
          ? "calendar.events.read"
          : "messages.unread.read",
        eventCursor: "per_user_workflow",
      };
    case "message_trigger":
      return { mentionsOnly: true, unreadOnly: true };
    case "library_changes":
      return { events: ["created", "updated"], ignoreProvenance: ["workflow_generated"] };
    case "debounce":
      return {
        seconds: 60,
        maximumItems: 500,
        groupBy:
          templateId === "unread-message-brief" ? ["channelId", "threadId"] : ["conversationId"],
      };
    case "source_query":
      return { limit: 100, requireCitations: true, userScopedConnections: true };
    case "read_content":
      return {
        pageSize: 50,
        maximumBytes: 25_000_000,
        continueUntilComplete: true,
        failOnSourceChange: true,
      };
    case "agent_task":
      return {
        instructions: taskInstruction(templateId),
        requireCitations: true,
        completionCriteria:
          "Return schema-valid grounded output; identify missing evidence explicitly.",
      };
    case "create_document":
      return {
        destination: ".summaries",
        filenameTemplate: "{{source.stem}}.summary.md",
        conflict: "replace_generated",
        provenance: "workflow_generated",
      };
    case "write_library_artifact":
      return { format: "markdown", provenance: "workflow_generated", conflict: "new_version" };
    case "update_metadata":
      return { mergeTags: true, preserveUserMetadata: true };
    case "post_reply":
      return { mode: "draft", destination: "private", sendRequiresExplicitEnablement: true };
    case "exact_tool":
      return {
        operation: "propose_organization",
        approvalRequiredFor: ["move", "overwrite", "delete"],
      };
    case "notify_private":
      return { destination: "agent_inbox", includeCitations: true, includePartialErrors: true };
    default:
      return {};
  }
}
