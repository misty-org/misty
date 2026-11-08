import { localTree } from "./localTree";
import { type MemoryRange, type NewMemory, rangeBounds } from "./memoryNodes";

export const treeApi = {
  /** Keeps a memory written by hand; answers with the new node's id. */
  add: (spaceId: string, memory: NewMemory) => localTree.add(spaceId, memory),
  /** The children of one node; without a parent, the branches. */
  children: async (spaceId: string, parent: string, range: MemoryRange) =>
    localTree.children(spaceId, parent, rangeBounds(range)),
  /** With dryRun, says what forgetting the node would remove without removing it. */
  forget: (spaceId: string, nodeId: string, range: MemoryRange, dryRun: boolean) =>
    localTree.forget(spaceId, nodeId, rangeBounds(range), dryRun),
};
