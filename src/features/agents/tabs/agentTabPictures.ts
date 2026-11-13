import { invoke } from "@tauri-apps/api/core";
import { setViewPicture, viewOfTab } from "../agent-browser/agentBrowserStore";
import { agentTab } from "./agentTabs";

const PICTURE_EVERY_MS = 1_500;
/** Wide enough to stay sharp in the PiP on a Retina screen. */
const PICTURE_WIDTH = 800;
const pictured = new Map<string, number>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** The tab a held-back picture is of: the one asked for last. */
const latest = new Map<string, string>();

/**
 * A small picture of a tab after the agent's step or a page load, for its view's switcher and the
 * PiP. At most one per view every PICTURE_EVERY_MS; one asked for sooner is taken when that time is
 * up, so the last change is never missed.
 */
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
