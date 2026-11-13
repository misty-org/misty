import { agentArtifactCredit, useSpaceAgentArtifacts } from "../../api/agent-artifacts";
import { useAuth } from "@/features/account";
import { useEffect, useMemo, useRef } from "react";

/**
 * Who made each file an agent saved to this Space ("Researcher, Bob’s agent"),
 * by item id. Files people added have no entry.
 */
export function useAgentArtifactCredits(spaceId: string, reloadKey: number) {
  const { user } = useAuth();
  const artifacts = useSpaceAgentArtifacts(spaceId);
  const { reload } = artifacts;
  const reloaded = useRef(reloadKey);
  useEffect(() => {
    if (reloaded.current === reloadKey) return;
    reloaded.current = reloadKey;
    void reload();
  }, [reload, reloadKey]);
  return useMemo(
    () =>
      new Map(
        (artifacts.data ?? []).map((artifact) => [
          artifact.item_id,
          agentArtifactCredit(artifact, user?.id ?? ""),
        ]),
      ),
    [artifacts.data, user?.id],
  );
}
