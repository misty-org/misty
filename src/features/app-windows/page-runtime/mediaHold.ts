import { invoke } from "@tauri-apps/api/core";

/**
 * Pages kept from playing because they came from, or moved because of, another computer and
 * nobody here is looking at them. A page not created yet is held from its first document.
 */
const held = new Set<string>();

export function isMediaHeld(viewId: string): boolean {
  return held.has(viewId);
}

/** `runtimeId` names a page that already exists. Resolves once it's safe to navigate it. */
export async function holdMedia(viewId: string, runtimeId?: string): Promise<void> {
  if (held.has(viewId)) return;
  held.add(viewId);
  if (!runtimeId) return;
  await invoke("browser_webview_set_media_hold", {
    request: { id: runtimeId, held: true },
  }).catch(() => undefined);
}

/** The person is looking at it. Nothing starts by itself; it just may now. */
export function releaseMedia(viewId: string, runtimeId?: string) {
  if (!held.delete(viewId) || !runtimeId) return;
  void invoke("browser_webview_set_media_hold", {
    request: { id: runtimeId, held: false },
  }).catch(() => undefined);
}

/** Forgets views no longer in this window's tabs. */
export function keepMediaHolds(present: Set<string>) {
  for (const id of held) if (!present.has(id)) held.delete(id);
}
