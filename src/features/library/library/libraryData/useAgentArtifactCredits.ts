import { agentArtifactCredit, agentArtifactsApi } from "@/api/spaces/agent-artifacts";
import { useAuth } from "@/features/auth";
import { useEffect, useState } from "react";

/**
 * Who made each file an agent saved to this Space ("Researcher, Bob’s agent"),
 * by item id. Files people added have no entry.
 */
export function useAgentArtifactCredits(spaceId: string, reloadKey: number) {
  const { user } = useAuth();
  const [credits, setCredits] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let current = true;
    void agentArtifactsApi
      .list(spaceId)
      .then(({ artifacts }) => {
        if (!current) return;
        setCredits(
          new Map(
            artifacts.map((artifact) => [
              artifact.item_id,
              agentArtifactCredit(artifact, user?.id ?? ""),
            ]),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [reloadKey, spaceId, user?.id]);
  return credits;
}
