import { currentSpaceKey } from "../engines/engines_api";
import { agentAccountId } from "../personal/agent_account";
import { multirunApi, type Multirun } from "./multirun_api";

const folders = new Map<string, string>();
let loadedFor: string | null = null;

const scope = () => `${agentAccountId()}\n${currentSpaceKey()}`;

export function rememberMultiruns(runs: Multirun[]) {
  folders.clear();
  for (const run of runs)
    for (const lane of run.lanes) folders.set(lane.conversationId, lane.folder);
  loadedFor = scope();
}

export async function multirunFolderOf(conversationId: string): Promise<string | undefined> {
  if (!conversationId) return undefined;
  if (loadedFor !== scope()) {
    const runs = await multirunApi.list(currentSpaceKey()).catch(() => null);
    if (!runs) return undefined;
    rememberMultiruns(runs);
  }
  return folders.get(conversationId);
}
