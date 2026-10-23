import { apiRequest } from "@/api/client";
import {
  type ForgetCounts,
  type MemoryNode,
  type MemoryRange,
  type NewMemory,
  rangeBounds,
} from "./model";

type Forgotten = { forgotten?: number; would_forget?: number; counts: ForgetCounts };

export const treeApi = {
  /** Keeps a memory written by hand; answers with the new node's id. */
  add: (spaceId: string, memory: NewMemory) =>
    apiRequest<{ id: string; branch: string }>("/me/memory/nodes", {
      method: "POST",
      body: JSON.stringify({ space_id: spaceId, ...memory }),
    }),
  /** The children of one node; without a parent, the branches. */
  children: async (spaceId: string, parent: string, range: MemoryRange) => {
    const params = new URLSearchParams({ space_id: spaceId });
    if (parent) params.set("parent", parent);
    for (const [key, value] of Object.entries(rangeBounds(range))) params.set(key, value);
    const { nodes } = await apiRequest<{ nodes: MemoryNode[] }>(`/me/memory/tree?${params}`);
    return nodes;
  },
  /** With dryRun, says what forgetting the node would remove without removing it. */
  forget: (spaceId: string, nodeId: string, range: MemoryRange, dryRun: boolean) =>
    apiRequest<Forgotten>("/me/memory/forget", {
      method: "POST",
      body: JSON.stringify({
        space_id: spaceId,
        node_id: nodeId,
        dry_run: dryRun,
        ...rangeBounds(range),
      }),
    }),
};
