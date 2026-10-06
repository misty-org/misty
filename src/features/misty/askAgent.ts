import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyPanelStore } from "@/features/agents";
import { showMistyConversation } from "./handoff";
import { useMistyStore } from "./useMistyStore";

/**
 * Asks an agent from the ⌘T panel: a new chat with it (its DM in the personal
 * Space) that starts with the text. `beside` keeps the page in view and opens
 * the chat in the side panel instead of its own tab.
 */
export async function askAgent(agentId: string, prompt: string, beside = false) {
  const text = prompt.trim();
  if (!text) return;
  const state = useMistyStore.getState();
  if (state.working)
    throw new Error("Wait for the current answer, or stop it, before asking again.");
  usePersonalAgentsStore.getState().select("", agentId);
  useMistyStore.setState({
    selectedAgentId: agentId,
    activeConversationId: "",
    query: text,
    context: [],
    handoff: undefined,
    mode: "ask",
  });
  if (beside) useMistyPanelStore.getState().setOpen(true);
  else showMistyConversation();
  await useMistyStore.getState().submitAnswer(text, [], undefined, beside ? "panel" : "workspace");
}
