import { useAgentBrowser } from "../agent-browser/agent_browser_store";

export function useAgentScreen(conversationId: string | undefined): string | undefined {
  return useAgentBrowser((state) => {
    const views = conversationId ? state.chats[conversationId]?.views : undefined;
    if (!views?.length) return undefined;
    const working = views
      .filter((view) => view.status === "working" && view.picture)
      .sort((a, b) => b.lastActed - a.lastActed)[0];
    return working?.picture;
  });
}
