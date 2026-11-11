import { currentSpaceKey } from "../engines/enginesApi";
import { agentAccountId } from "../personal/agentAccount";
import { multirunApi, type Multirun } from "./multirunApi";

/**
 * Which chats belong to a multi-run lane, and the worktree each works in. A turn in such a chat
 * names that worktree as its engine's folder, so a follow-up continues where the lane left off.
 * Native code accepts the folder only because it recorded the worktree itself.
 */
const folders = new Map<string, string>();
let loadedFor: string | null = null;

const scope = () => `${agentAccountId()}\n${currentSpaceKey()}`;

/** Takes the Space's multi-runs as just read, replacing what was known. */
export function rememberMultiruns(runs: Multirun[]) {
  folders.clear();
  for (const run of runs)
    for (const lane of run.lanes) folders.set(lane.conversationId, lane.folder);
  loadedFor = scope();
}

/** The worktree a chat's turns run in, when the chat is a multi-run lane that still exists. */
export async function multirunFolderOf(conversationId: string): Promise<string | undefined> {
  if (!conversationId) return undefined;
  if (loadedFor !== scope()) {
    const runs = await multirunApi.list(currentSpaceKey()).catch(() => null);
    if (!runs) return undefined;
    rememberMultiruns(runs);
  }
  return folders.get(conversationId);
}
