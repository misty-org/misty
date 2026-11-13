import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { agentAccountId } from "../../personal/agentAccount";

/**
 * A turn belongs to whoever this window is working for, the signed-in account. It asks nothing of
 * the server: agents run on this computer.
 */
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
