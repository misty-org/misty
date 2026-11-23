import { useAgentBrowser } from "../agent-browser/agent_browser_store";

export interface AgentTab {
  scopeId: string;
  viewId: string;
  taskId: string;
  runId: string;
  url: string;
  title: string;
  lastUsed: number;
  busy: number;
  byPerson?: boolean;
}

export function restoredAgentTabs(): Map<string, AgentTab> {
  const tabs = new Map<string, AgentTab>();
  for (const chat of Object.values(useAgentBrowser.getState().chats))
    for (const view of chat.views)
      for (const scopeId of view.tabs) {
        const tab = useAgentBrowser.getState().tabs[scopeId];
        if (tab)
          tabs.set(scopeId, {
            scopeId,
            viewId: "",
            taskId: view.taskId,
            runId: "",
            url: tab.url,
            title: tab.title,
            lastUsed: 0,
            busy: 0,
            ...(scopeId.startsWith("person-") ? { byPerson: true } : {}),
          });
      }
  return tabs;
}

export const agentPageBounds = () => ({
  x: 0,
  y: 64,
  width: Math.max(200, window.innerWidth - 440),
  height: Math.max(300, window.innerHeight - 128),
});
