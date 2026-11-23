import { invoke } from "@tauri-apps/api/core";
import { setViewPicture, viewOfTab } from "../agent-browser/agent_browser_store";
import { agentTab } from "./agent_tabs";

const PICTURE_EVERY_MS = 1_500;
const PICTURE_WIDTH = 800;
const pictured = new Map<string, number>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const latest = new Map<string, string>();

export async function pictureAgentTab(scopeId: string) {
  const view = viewOfTab(scopeId)?.view;
  if (!view) return;
  const wait = PICTURE_EVERY_MS - (Date.now() - (pictured.get(view.id) ?? 0));
  if (wait > 0) {
    latest.set(view.id, scopeId);
    if (!pending.has(view.id))
      pending.set(
        view.id,
        setTimeout(() => {
          pending.delete(view.id);
          const scope = latest.get(view.id) ?? scopeId;
          latest.delete(view.id);
          void pictureAgentTab(scope);
        }, wait),
      );
    return;
  }
  const tab = agentTab(scopeId);
  if (!tab?.viewId) return;
  pictured.set(view.id, Date.now());
  const picture = await invoke<{ dataUrl?: string }>("browser_webview_picture", {
    request: { id: tab.viewId, width: PICTURE_WIDTH },
  }).catch(() => undefined);
  if (picture?.dataUrl) setViewPicture(view.id, picture.dataUrl);
}
