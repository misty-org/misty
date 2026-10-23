import { useAgentBrowser } from "./agentBrowser/agentBrowserStore";

export interface AgentTab {
  scopeId: string;
  /** The live page's id, or "" while the tab sleeps. */
  viewId: string;
  taskId: string;
  runId: string;
  url: string;
  title: string;
  lastUsed: number;
  /** Jobs running on it now; a tab in use never sleeps. */
  busy: number;
  /** The person added it in the agent browser for the agent to use; the agent never closes it. */
  byPerson?: boolean;
}

/** After a reload the store (agentBrowserStore.ts) brings its tabs back asleep; the records the
 * pages are opened from are rebuilt from them, so showing one opens its address again. */
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

/** The size a hidden agent page renders at: about the person's page area. */
export const agentPageBounds = () => ({
  x: 0,
  y: 64,
  width: Math.max(200, window.innerWidth - 440),
  height: Math.max(300, window.innerHeight - 128),
});
