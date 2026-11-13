import { invoke } from "@tauri-apps/api/core";
import {
  addBrowserTab,
  addPersonView,
  closeAgentBrowser,
  isBrowserOpen,
  setBrowserExpanded,
  updateBrowserTab,
  useAgentBrowser,
} from "../agent-browser/agentBrowserStore";
import { agentTab, agentTabsForTask, rememberAgentTab, wakeAgentTab } from "./agentTabs";

/**
 * The rail's browser button: opens the chat's agent browser in the split, or puts it away when it
 * is open. A chat whose agent has opened no page yet gets one blank tab to type an address into.
 * Its pages are the agent's own, so the agent works in whatever the person opened here.
 */
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

/** Sends the tab the person is looking at to an address they typed, waking its page if it sleeps. */
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

/** Opens an address in the chat's agent browser, opening the browser first if it is put away. */
export function openInChatBrowser(conversationId: string, url: string): Promise<boolean> {
  if (!isBrowserOpen(useAgentBrowser.getState().chats[conversationId]))
    toggleChatBrowser(conversationId);
  const chat = useAgentBrowser.getState().chats[conversationId];
  const view = chat?.views.find((item) => item.id === chat.shownView) ?? chat?.views[0];
  return view ? navigateShownTab(view.shownScope, url) : Promise.resolve(false);
}
