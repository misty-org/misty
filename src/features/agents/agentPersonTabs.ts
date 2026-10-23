import { addBrowserTab, updateBrowserTab } from "./agentBrowser/agentBrowserStore";
import { agentTab, agentTabsForTask, rememberAgentTab, wakeAgentTab } from "./agentTabs";

/**
 * A tab the person adds in a view's strip: blank until they give it an address, then a page of the
 * agent's own like any other, bound to the same task so its programs can use it.
 */
export function addPersonTab(
  conversationId: string,
  view: { id: string; label: string; taskId: string },
) {
  const sibling = agentTabsForTask(view.taskId)[0];
  if (!sibling) return undefined;
  const scopeId = `person-${crypto.randomUUID()}`;
  rememberAgentTab({
    scopeId,
    viewId: "",
    taskId: view.taskId,
    runId: sibling.runId,
    url: "",
    title: "",
    lastUsed: Date.now(),
    busy: 0,
    byPerson: true,
  });
  addBrowserTab(conversationId, view, { scopeId, url: "", title: "", viewId: "" });
  return scopeId;
}

/** Gives a person's blank tab its address and opens it. */
export function openPersonTab(scopeId: string, url: string) {
  const tab = agentTab(scopeId);
  if (!tab) return Promise.resolve(false);
  tab.url = url;
  updateBrowserTab(scopeId, { url });
  return wakeAgentTab(scopeId);
}
