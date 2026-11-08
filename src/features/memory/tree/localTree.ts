import { deviceMemory, type ForgetCountsResult } from "@/api/runtime/device-memory";
import { memoryWorkflows, type MemoryWorkflow } from "./workflowSource";
import { memorySpaceKey } from "../recall/windowSpace";
import type { MemoryNode, NewMemory } from "./memoryNodes";

/**
 * A Space's tree on this computer. Moments, summaries and facts are in native Memory; saved workflows
 * are kept by their own tools (`features/agents/workflows`), and show in the tree's fourth branch.
 */

type Bounds = { from?: string; to?: string };

function oneLine(text: string, limit: number): string {
  const joined = text.split(/\s+/).filter(Boolean).join(" ");
  const characters = [...joined];
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : joined;
}

const account = () => memoryWorkflows.get().accountId();

async function workflowsIn(space: string): Promise<MemoryWorkflow[]> {
  const methods = await memoryWorkflows.get().list(account());
  return methods.filter((method) => method.enabled && method.space_id === space);
}

function workflowNode(method: MemoryWorkflow): MemoryNode {
  const { title, description, instructions } = method.definition;
  return {
    id: `workflow:${method.id}`,
    parent: "workflows",
    type: "workflow",
    branch: "workflows",
    source: method.kind,
    label: oneLine(title.trim() ? title : "Untitled workflow", 80),
    detail: method.kind,
    count: 0,
    preview: oneLine(description, 140),
    text: oneLine(instructions, 2000),
    last_at: method.updated_at,
    searchable: true,
    expandable: false,
  };
}

/** The children of one node in a Space named as Memory names it. */
export async function childrenIn(space: string, parent: string, bounds: Bounds) {
  if (parent === "workflows") return (await workflowsIn(space)).map(workflowNode);
  const nodes = await deviceMemory.tree<MemoryNode>({ space_id: space, parent, ...bounds });
  if (parent) return nodes;
  const count = (await workflowsIn(space)).length;
  return nodes.map((node) =>
    node.id === "workflows" ? { ...node, count, searchable: true, expandable: count > 0 } : node,
  );
}

/** Forgetting a workflow turns it off, as it does on the server: its row stays for its schedules. */
async function forgetWorkflows(space: string, nodeId: string, dryRun: boolean): Promise<number> {
  const only = nodeId.startsWith("workflow:") ? nodeId.slice("workflow:".length) : "";
  if (!only && nodeId !== "workflows" && nodeId !== "space") return 0;
  const methods = (await workflowsIn(space)).filter((method) => !only || method.id === only);
  if (dryRun) return methods.length;
  for (const method of methods) {
    await memoryWorkflows.get().save(account(), {
      id: method.id,
      agent_id: method.agent_id,
      kind: method.kind,
      enabled: false,
      expected_version: method.version,
      definition: method.definition,
    });
  }
  return methods.length;
}

export const localTree = {
  children: (spaceId: string, parent: string, bounds: Bounds) =>
    childrenIn(memorySpaceKey(spaceId), parent, bounds),
  add: async (spaceId: string, memory: NewMemory) => {
    const space = memorySpaceKey(spaceId);
    if (memory.branch !== "workflows") {
      return deviceMemory.addNode({
        space_id: space,
        branch: memory.branch,
        title: memory.title,
        text: memory.text,
        kind: memory.kind,
      });
    }
    const saved = await memoryWorkflows.get().save(account(), {
      agent_id: "",
      kind: "workflow",
      enabled: true,
      space_id: space,
      definition: {
        title: memory.title?.trim() ?? "",
        description: memory.description?.trim() ?? "",
        instructions: memory.text.trim(),
        target: "cloud",
        inputs: [],
        required_tools: [],
      },
    });
    return { id: `workflow:${saved.id}`, branch: "workflows" };
  },
  forget: async (
    spaceId: string,
    nodeId: string,
    bounds: Bounds,
    dryRun: boolean,
  ): Promise<ForgetCountsResult> => {
    const space = memorySpaceKey(spaceId);
    const workflows = await forgetWorkflows(space, nodeId, dryRun);
    const only = nodeId === "workflows" || nodeId.startsWith("workflow:");
    const native: ForgetCountsResult = only
      ? { counts: { moments: 0, summaries: 0, facts: 0, workflows: 0 } }
      : await deviceMemory.forget({
          space_id: space,
          node_id: nodeId,
          dry_run: dryRun,
          ...bounds,
        });
    const counts = { ...native.counts, workflows };
    const total = counts.moments + counts.summaries + counts.facts + counts.workflows;
    return dryRun ? { would_forget: total, counts } : { forgotten: total, counts };
  },
};
