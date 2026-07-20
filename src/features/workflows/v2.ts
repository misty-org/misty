import type {
  WorkflowRisk,
  WorkflowExecutionLocation,
  JSONSchema,
  WorkflowBinding,
  WorkflowNodeKind,
} from "@/models/types/features/workflows/v2";
export type {
  WorkflowRisk,
  WorkflowExecutionLocation,
  JSONSchema,
  WorkflowBinding,
  WorkflowNodeKind,
} from "@/models/types/features/workflows/v2";
import type {
  ContentRef,
  ContentSection,
  ContentCitation,
  ContentPage,
  WorkflowCapabilityRequirement,
  WorkflowRetryPolicy,
  WorkflowErrorPolicy,
  WorkflowNodeV2,
  WorkflowEdgeV2,
  WorkflowDependency,
  WorkflowDefinitionV2,
  WorkflowNodeDescriptor,
} from "@/models/interfaces/features/workflows/v2";
export type {
  ContentRef,
  ContentSection,
  ContentCitation,
  ContentPage,
  WorkflowCapabilityRequirement,
  WorkflowRetryPolicy,
  WorkflowErrorPolicy,
  WorkflowNodeV2,
  WorkflowEdgeV2,
  WorkflowDependency,
  WorkflowDefinitionV2,
  WorkflowNodeDescriptor,
} from "@/models/interfaces/features/workflows/v2";
export const workflowFormatVersion = 2 as const;

export const workflowNodeRegistry: readonly WorkflowNodeDescriptor[] = [
  descriptor("manual_trigger", "Manual / chat", "Triggers", "triggers.read", "read", "cloud"),
  descriptor("cron_trigger", "Schedule", "Triggers", "triggers.read", "read", "cloud", {
    expression: "0 9 * * *",
    timezone: "UTC",
  }),
  descriptor("file_changes", "File changes", "Triggers", "triggers.read", "read", "device", {
    include: ["**/*"],
    exclude: [".summaries/**"],
  }),
  descriptor("library_changes", "Library changes", "Triggers", "triggers.read", "read", "cloud"),
  descriptor("message_trigger", "Chat messages", "Triggers", "triggers.read", "read", "cloud"),
  descriptor("connector_trigger", "Connector event", "Triggers", "triggers.read", "read", "cloud"),
  descriptor("task_change_trigger", "Task changes", "Triggers", "triggers.read", "read", "cloud"),
  descriptor(
    "changed_files",
    "Changed files",
    "Data",
    "files.read",
    "read",
    "device",
    { excludeGenerated: true },
    {
      type: "object",
      required: ["items", "claimed", "provenance"],
      properties: {
        items: { type: "array" },
        claimed: { type: "integer" },
        provenance: { type: "object" },
      },
    },
  ),
  descriptor("source_query", "Query source", "Data", "content.read", "read", "either"),
  descriptor(
    "read_content",
    "Read content",
    "Data",
    "content.read",
    "read",
    "either",
    { pageSize: 50 },
    {
      type: "object",
      required: ["content", "sections", "citations", "truncated", "sourceChanged"],
      properties: {
        content: { type: "object" },
        sections: { type: "array" },
        citations: { type: "array" },
        nextCursor: { type: "string" },
        truncated: { type: "boolean" },
        sourceChanged: { type: "boolean" },
      },
    },
  ),
  descriptor("read_metadata", "Read metadata", "Data", "content.read", "read", "either"),
  descriptor(
    "task_query",
    "Query Space tasks",
    "Data",
    "tasks.read",
    "read",
    "cloud",
    { status: "", assigneeUserId: "" },
    { type: "object", required: ["tasks"], properties: { tasks: { type: "array" } } },
  ),
  descriptor(
    "calendar_query",
    "Query Space calendar",
    "Data",
    "calendar.read",
    "read",
    "cloud",
    { daysBefore: 0, daysAfter: 30 },
    { type: "object", required: ["events"], properties: { events: { type: "array" } } },
  ),
  descriptor("transform", "Transform", "Data", "workflow.control", "read", "cloud"),
  descriptor("for_each", "For each", "Control", "workflow.control", "read", "cloud", {
    concurrency: 4,
    maximumItems: 1000,
    errorMode: "collect",
  }),
  descriptor("condition", "Condition", "Control", "workflow.control", "read", "cloud"),
  descriptor("switch", "Switch", "Control", "workflow.control", "read", "cloud"),
  descriptor("join", "Join", "Control", "workflow.control", "read", "cloud"),
  descriptor("debounce", "Debounce / batch", "Control", "workflow.control", "read", "cloud", {
    seconds: 60,
  }),
  descriptor("delay", "Delay", "Control", "workflow.control", "read", "cloud", { seconds: 60 }),
  descriptor("call_workflow", "Call workflow", "Control", "workflow.control", "read", "cloud"),
  descriptor("agent_task", "Agent task", "Intelligence", "agent.reason", "read", "cloud", {
    instructions: "Complete this step using the available workflow capabilities.",
  }),
  descriptor("create_document", "Create document", "Actions", "files.write", "write", "either", {
    destination: ".summaries",
    conflict: "replace_generated",
  }),
  descriptor(
    "write_library_artifact",
    "Write Library artifact",
    "Actions",
    "library.write",
    "write",
    "cloud",
  ),
  descriptor(
    "notify_private",
    "Private result",
    "Actions",
    "notifications.write",
    "write",
    "cloud",
    {},
    {
      type: "object",
      required: ["notified", "eventId"],
      properties: { notified: { type: "boolean" }, eventId: { type: "string" } },
    },
  ),
  descriptor(
    "post_reply",
    "Post / reply",
    "Actions",
    "messages.write",
    "write",
    "cloud",
    { mode: "draft", destination: "private" },
    {
      type: "object",
      required: ["posted", "messageId"],
      properties: {
        posted: { type: "boolean" },
        messageId: { type: "string" },
        draft: { type: "string" },
      },
    },
  ),
  descriptor("update_metadata", "Update metadata", "Actions", "library.write", "write", "cloud"),
  descriptor(
    "memory_write",
    "Write Agent memory",
    "Actions",
    "memory.write",
    "write",
    "cloud",
    {},
    {
      type: "object",
      required: ["written", "memoryEventId"],
      properties: { written: { type: "boolean" }, memoryEventId: { type: "integer" } },
    },
  ),
  descriptor(
    "create_task",
    "Create Space task",
    "Actions",
    "tasks.write",
    "write",
    "cloud",
    { destination: "space_tasks" },
    { type: "object", required: ["task"], properties: { task: { type: "object" } } },
  ),
  descriptor(
    "update_task",
    "Update Space task",
    "Actions",
    "tasks.write",
    "write",
    "cloud",
    { destination: "space_tasks" },
    { type: "object", required: ["task"], properties: { task: { type: "object" } } },
  ),
  descriptor(
    "delete_resource",
    "Delete resource",
    "Actions",
    "resources.delete",
    "destructive",
    "either",
  ),
  descriptor(
    "change_permissions",
    "Change permissions",
    "Actions",
    "permissions.write",
    "destructive",
    "cloud",
  ),
  descriptor("exact_tool", "Exact provider tool", "Actions", "tools.execute", "write", "either"),
  descriptor("http_request", "HTTP request", "Actions", "http.write", "write", "cloud", {
    method: "GET",
    url: "",
    headers: {},
    query: {},
    body: {},
    timeoutSeconds: 30,
    responseSchema: { type: "object" },
  }),
] as const;

function descriptor(
  kind: WorkflowNodeKind,
  label: string,
  group: WorkflowNodeDescriptor["group"],
  capability: string,
  risk: WorkflowRisk,
  location: WorkflowExecutionLocation,
  defaultConfig: Record<string, unknown> = {},
  defaultOutputSchema: JSONSchema = { type: "object" },
): WorkflowNodeDescriptor {
  return { kind, label, group, capability, risk, location, defaultConfig, defaultOutputSchema };
}

export function createWorkflowNode(
  kind: WorkflowNodeKind,
  position?: { x: number; y: number },
): WorkflowNodeV2 {
  const entry = workflowNodeRegistry.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`Unknown workflow node: ${kind}`);
  return {
    id: `${kind}_${crypto.randomUUID()}`,
    kind,
    kindVersion: 1,
    label: entry.label,
    config: structuredClone(entry.defaultConfig),
    outputSchema: structuredClone(entry.defaultOutputSchema),
    retry: { maxAttempts: 3, cooldownSeconds: 60 },
    errors: { mode: kind === "for_each" ? "collect" : "fail", acceptsPartial: kind === "for_each" },
    position,
  };
}

export function createConfiguredWorkflowNode(
  kind: WorkflowNodeKind,
  label: string,
  config: Record<string, unknown>,
  capability: string,
  risk: WorkflowRisk,
  position?: { x: number; y: number },
): { node: WorkflowNodeV2; capability: WorkflowCapabilityRequirement } {
  const node = createWorkflowNode(kind, position);
  node.label = label;
  node.config = { ...node.config, ...structuredClone(config) };
  return { node, capability: { capability, risk } };
}

export function validateWorkflowV2(definition: WorkflowDefinitionV2): string[] {
  return validateWorkflowDefinition(definition, 0);
}

function validateWorkflowDefinition(definition: WorkflowDefinitionV2, depth: number): string[] {
  const errors: string[] = [];
  if (depth > 16) return ["Workflow child graph nesting exceeds 16 levels."];
  if (definition.formatVersion !== workflowFormatVersion)
    errors.push("Workflow formatVersion must be 2.");
  if (!definition.nodes.length) errors.push("Add at least one node.");
  const byId = new Map<string, WorkflowNodeV2>();
  for (const node of definition.nodes) {
    if (!node.id.trim() || byId.has(node.id))
      errors.push(`Duplicate or empty node ID: ${node.id || "(empty)"}.`);
    byId.set(node.id, node);
    if (!workflowNodeRegistry.some((entry) => entry.kind === node.kind))
      errors.push(`Unsupported node: ${node.kind}.`);
    if (node.retry.maxAttempts !== 3 || node.retry.cooldownSeconds !== 60)
      errors.push(`${node.label} must use three total attempts and a 60-second cooldown.`);
    if (node.kind === "for_each") {
      const child = node.config.childGraph as WorkflowDefinitionV2 | undefined;
      const pinned =
        typeof node.config.workflowVersionId === "string" ? node.config.workflowVersionId : "";
      if (Boolean(child) === Boolean(pinned))
        errors.push(`${node.label} requires exactly one child graph or version-pinned subflow.`);
      if (pinned && !definition.dependencies.some((dependency) => dependency.versionId === pinned))
        errors.push(`${node.label} references an undeclared workflow version.`);
      if (child)
        errors.push(
          ...validateWorkflowDefinition(child, depth + 1).map((error) => `${node.label}: ${error}`),
        );
    }
    if (node.kind === "call_workflow") {
      const pinned =
        typeof node.config.workflowVersionId === "string" ? node.config.workflowVersionId : "";
      if (!pinned || !definition.dependencies.some((dependency) => dependency.versionId === pinned))
        errors.push(`${node.label} must reference a declared workflow version.`);
    }
  }
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const targetPorts = new Set<string>();
  for (const id of byId.keys()) incoming.set(id, 0);
  for (const edge of definition.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target)
      errors.push(`Invalid edge: ${edge.id}.`);
    const port = `${edge.target}:${edge.targetPort}`;
    if (targetPorts.has(port)) errors.push(`Input port ${port} has more than one connection.`);
    targetPorts.add(port);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const count = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  if (visited !== byId.size)
    errors.push(
      "Workflow graph contains a cycle. Use For each or Call workflow for controlled iteration.",
    );
  const declared = new Map(
    definition.capabilities.map((entry) => [entry.capability, riskRank(entry.risk)]),
  );
  for (const node of definition.nodes) {
    const entry = workflowNodeRegistry.find((candidate) => candidate.kind === node.kind);
    if (entry && (declared.get(entry.capability) ?? 0) < riskRank(entry.risk))
      errors.push(`${node.label} requires ${entry.capability} (${entry.risk}).`);
  }
  return errors;
}

function riskRank(risk: WorkflowRisk): number {
  return risk === "destructive" ? 3 : risk === "write" ? 2 : 1;
}
