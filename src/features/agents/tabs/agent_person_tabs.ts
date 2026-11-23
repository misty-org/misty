import { invoke } from "@tauri-apps/api/core";
import {
  addBrowserTab,
  addPersonView,
  closeAgentBrowser,
  isBrowserOpen,
  setBrowserExpanded,
  updateBrowserTab,
  useAgentBrowser,
} from "../agent-browser/agent_browser_store";
import { agentTab, agentTabsForTask, rememberAgentTab, wakeAgentTab } from "./agent_tabs";

export function toggleChatBrowser(conversationId: string) {
  const chat = useAgentBrowser.getState().chats[conversationId];
  if (isBrowserOpen(chat)) return closeAgentBrowser(conversationId);
  if (chat?.views.length) return setBrowserExpanded(conversationId, true);
  const scopeId = `person-${crypto.randomUUID()}`;
  rememberAgentTab({
    scopeId,
    viewId: "",
    taskId: "",
    runId: "",
    url: "",
    title: "",
    lastUsed: Date.now(),
    busy: 0,
    byPerson: true,
  });
  addPersonView(conversationId, { scopeId, url: "", title: "", viewId: "" });
}

export async function navigateShownTab(scopeId: string, url: string): Promise<boolean> {
  const tab = agentTab(scopeId);
  if (!tab) return false;
  if (!tab.viewId) return openPersonTab(scopeId, url);
  tab.url = url;
  updateBrowserTab(scopeId, { url });
  try {
    await invoke("browser_webview_navigate", { request: { id: tab.viewId, url } });
    return true;
  } catch {
    return false;
  }
}

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

export function openPersonTab(scopeId: string, url: string) {
  const tab = agentTab(scopeId);
  if (!tab) return Promise.resolve(false);
  tab.url = url;
  updateBrowserTab(scopeId, { url });
  return wakeAgentTab(scopeId);
}

export function openInChatBrowser(conversationId: string, url: string): Promise<boolean> {
  if (!isBrowserOpen(useAgentBrowser.getState().chats[conversationId]))
    toggleChatBrowser(conversationId);
  const chat = useAgentBrowser.getState().chats[conversationId];
  const view = chat?.views.find((item) => item.id === chat.shownView) ?? chat?.views[0];
  return view ? navigateShownTab(view.shownScope, url) : Promise.resolve(false);
}
