import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { agentAccountId } from "../../personal/agent_account";

export async function assertMistyAvailable(
  accountId: string,
  _legacySpaceId?: string,
): Promise<void> {
  const generation = readApiSessionGeneration();
  if (isApiSessionTransitioning() || readApiSessionGeneration() !== generation)
    throw new Error("The Misty account changed. Open Misty again.");
  if (agentAccountId() !== accountId)
    throw new Error("The Misty account changed. Open Misty again.");
}
