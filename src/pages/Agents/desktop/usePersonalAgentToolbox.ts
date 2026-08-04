import { useRef, useState } from "react";
import { personalAgentsApi } from "@/stores/agents/usePersonalAgentsStore";
import type {
  AgentToolboxAction,
  AgentToolboxActivity,
} from "@/models/interfaces/features/spaces/agentArchitectureTypes";

export function usePersonalAgentToolbox() {
  const [actions, setActions] = useState<AgentToolboxAction[]>([]);
  const [activity, setActivity] = useState<AgentToolboxActivity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const requestGeneration = useRef(0);

  const load = (agentId: string | null, onError: (message: string) => void) => {
    const generation = ++requestGeneration.current;
    setActions([]);
    setActivity([]);
    setLoaded(false);
    const request = agentId
      ? personalAgentsApi.toolbox(agentId)
      : personalAgentsApi.toolboxCatalog();
    void request
      .then((toolbox) => {
        if (generation !== requestGeneration.current) return;
        setActions(toolbox.actions);
        setActivity(toolbox.recent_activity);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (generation !== requestGeneration.current) return;
        onError(error instanceof Error ? error.message : "Agent Toolbox could not be loaded.");
      });
  };

  return { actions, activity, loaded, setActions, load };
}
