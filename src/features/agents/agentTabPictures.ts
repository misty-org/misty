import { invoke } from "@tauri-apps/api/core";
import { setViewPicture, viewOfTab } from "./agentBrowser/agentBrowserStore";
import { agentTab } from "./agentTabs";

const PICTURE_EVERY_MS = 2_000;
const pictured = new Map<string, number>();

/** A small picture of a tab after the agent's step, for its view's switcher and the PiP. */
export async function pictureAgentTab(scopeId: string) {
  const tab = agentTab(scopeId);
  const view = viewOfTab(scopeId)?.view;
  if (!tab?.viewId || !view || Date.now() - (pictured.get(view.id) ?? 0) < PICTURE_EVERY_MS) return;
  pictured.set(view.id, Date.now());
  const picture = await invoke<{ dataUrl?: string }>("browser_webview_picture", {
    request: { id: tab.viewId },
  }).catch(() => undefined);
  if (picture?.dataUrl) setViewPicture(view.id, picture.dataUrl);
}
