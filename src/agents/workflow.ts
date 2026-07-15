import type {
  AgentActionKind,
  AgentTriggerKind,
  AgentWorkflow,
  AgentWorkflowNode,
  AgentWorkflowNodeKind,
} from "./types";

const triggerKinds: Record<AgentTriggerKind, AgentWorkflowNodeKind> = {
  manual: "manual_trigger",
  schedule: "schedule_trigger",
  file_created: "file_event",
  file_changed: "file_event",
  local_webhook: "local_webhook",
};

const mutationKinds = new Set<AgentActionKind>(["overwrite", "rename", "move", "delete", "change_permissions"]);

export interface WorkflowPlan {
  nodes: AgentWorkflowNode[];
  has: (kind: AgentWorkflowNodeKind) => boolean;
  allows: (kind: AgentWorkflowNodeKind, action: AgentActionKind, mode: "automatic" | "approval") => boolean;
}

export interface PlannedMutationAction {
  kind: "overwrite" | "rename" | "move" | "delete" | "change_permissions";
  summary: string;
  scopeId: string;
  relativePaths: string[];
  destinationRelativePath?: string;
  contentSource?: "mika_answer";
  contentSha256?: string;
  unixMode?: number;
}

/**
 * Produces the only nodes a job may execute: nodes reachable from the exact
 * saved trigger root, in stable topological order. Dangling edges and cycles
 * fail closed instead of silently widening the workflow's permissions.
 */
export function planAgentWorkflow(workflow: AgentWorkflow | undefined, trigger: string): WorkflowPlan {
  if (!workflow) return legacyPlan();
  const expectedRoot = triggerKinds[trigger as AgentTriggerKind];
  if (!expectedRoot) throw new Error("The job trigger is not supported by this workflow.");
  const byId = new Map<string, AgentWorkflowNode>();
  for (const node of workflow.nodes) {
    if (!node.id || byId.has(node.id)) throw new Error("The saved workflow has duplicate or empty node ids.");
    byId.set(node.id, node);
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) throw new Error("The saved workflow contains a dangling edge.");
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const roots = workflow.nodes.filter((node) => node.kind === expectedRoot && triggerMatchesNode(node, trigger));
  if (!roots.length) throw new Error("This trigger is not enabled by the saved agent workflow.");
  const reachable = new Set<string>();
  const pending = roots.map((node) => node.id);
  while (pending.length) {
    const id = pending.shift() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }
  const reachableIncoming = new Map<string, number>();
  for (const id of reachable) reachableIncoming.set(id, 0);
  for (const edge of workflow.edges) {
    if (reachable.has(edge.from) && reachable.has(edge.to)) {
      reachableIncoming.set(edge.to, (reachableIncoming.get(edge.to) ?? 0) + 1);
    }
  }
  const queue = workflow.nodes.filter((node) => reachable.has(node.id) && reachableIncoming.get(node.id) === 0);
  const ordered: AgentWorkflowNode[] = [];
  while (queue.length) {
    const node = queue.shift() as AgentWorkflowNode;
    ordered.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      if (!reachable.has(target)) continue;
      const next = (reachableIncoming.get(target) ?? 0) - 1;
      reachableIncoming.set(target, next);
      if (next === 0) queue.push(byId.get(target) as AgentWorkflowNode);
    }
  }
  if (ordered.length !== reachable.size) throw new Error("The saved workflow contains a reachable cycle.");
  return createPlan(ordered);
}

export function plannedMutation(plan: WorkflowPlan, scopeId: string): PlannedMutationAction | null {
  const approvalNode = plan.nodes.find((node) => node.kind === "approval" && mutationFromNode(node, scopeId));
  return approvalNode ? mutationFromNode(approvalNode, scopeId) : null;
}

function mutationFromNode(node: AgentWorkflowNode, scopeId: string): PlannedMutationAction | null {
  const configured = recordValue(node.config.action) ?? node.config;
  const kind = stringValue(configured.kind || configured.actionKind) as AgentActionKind;
  if (!mutationKinds.has(kind) || !node.policy.some((entry) => entry.action === kind && entry.mode === "approval")) return null;
  const relativePaths = Array.isArray(configured.relativePaths)
    ? configured.relativePaths.filter((value): value is string => typeof value === "string")
    : [];
  if (!relativePaths.length || !relativePaths.every(validRelativePath)) throw new Error("The approval step contains an invalid relative path.");
  const destinationRelativePath = stringValue(configured.destinationRelativePath);
  if (destinationRelativePath && !validRelativePath(destinationRelativePath)) throw new Error("The approval destination is outside its agent scope.");
  if ((kind === "rename" || kind === "move") && !destinationRelativePath) throw new Error("The approval step requires a destination path.");
  const summary = stringValue(configured.summary);
  if (!summary) throw new Error("The approval step requires an exact action summary.");
  const contentSource = configured.contentSource === "mika_answer" ? "mika_answer" : undefined;
  const unixMode = typeof configured.unixMode === "number" ? configured.unixMode : undefined;
  if (kind === "change_permissions" && (!Number.isInteger(unixMode) || (unixMode as number) < 0 || (unixMode as number) > 0o777)) {
    throw new Error("The approval step requires a Unix mode between 0000 and 0777.");
  }
  return {
    kind: kind as PlannedMutationAction["kind"],
    summary,
    scopeId,
    relativePaths,
    ...(destinationRelativePath ? { destinationRelativePath } : {}),
    ...(contentSource ? { contentSource } : {}),
    ...(unixMode !== undefined ? { unixMode } : {}),
  };
}

function triggerMatchesNode(node: AgentWorkflowNode, trigger: string): boolean {
  if (node.kind !== "file_event") return true;
  const configured = stringValue(node.config.event);
  return !configured || configured === trigger;
}

function createPlan(nodes: AgentWorkflowNode[]): WorkflowPlan {
  return {
    nodes,
    has: (kind) => nodes.some((node) => node.kind === kind),
    allows: (kind, action, mode) => nodes.some((node) =>
      node.kind === kind && node.policy.some((entry) => entry.action === action && entry.mode === mode)),
  };
}

function legacyPlan(): WorkflowPlan {
  return createPlan([
    { id: "legacy-trigger", kind: "manual_trigger", config: {}, policy: [] },
    { id: "legacy-query", kind: "folder_query", config: {}, policy: [{ action: "search", mode: "automatic" }] },
    { id: "legacy-read", kind: "document_read", config: {}, policy: [{ action: "read", mode: "automatic" }] },
    { id: "legacy-task", kind: "mika_task", config: {}, policy: [{ action: "summarize", mode: "automatic" }] },
    { id: "legacy-artifact", kind: "artifact_create", config: {}, policy: [{ action: "create_file", mode: "automatic" }] },
  ]);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").trim();
  return Boolean(normalized)
    && normalized.length <= 1024
    && !normalized.startsWith("/")
    && !normalized.includes(":")
    && normalized.split("/").every((component) => component !== "" && component !== "." && component !== "..");
}
