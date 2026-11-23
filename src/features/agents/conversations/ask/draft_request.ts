import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/app-windows";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { useMistyStore } from "../state/use_misty_store";

export function draftRequestForAgent(agentId: string, text: string): string | undefined {
  const state = useMistyStore.getState();
  if (state.working) return "Your agent is working. Try again when it finishes.";
  if (state.query.trim() && state.query !== text)
    return "Send or clear the message you're writing to your agent first.";
  const route = `/agents?${new URLSearchParams({ agent: agentId, new: String(Date.now()) })}`;
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return "The agent's chat couldn't be opened.";
  usePersonalAgentsStore.getState().select("", agentId);
  useMistyStore.setState({
    selectedAgentId: agentId,
    activeConversationId: "",
    query: text,
    context: [],
    handoff: undefined,
  });
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
  return undefined;
}
