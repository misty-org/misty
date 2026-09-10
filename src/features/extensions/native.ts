import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import type {
  ExtensionCapabilities,
  ExtensionReview,
  Installation,
  InstalledState,
  ExtensionAction,
} from "./types";
async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await nativeInvoke<T>(command, args);
  } catch (failure) {
    if (failure && typeof failure === "object" && "message" in failure)
      throw Object.assign(new Error(String(failure.message)), failure);
    throw failure;
  }
}
export const extensionsNative = {
  capabilities: () =>
    invoke<ExtensionCapabilities>("extensions_action", { operation: "diagnostics" }),
  layout: (
    tabs: {
      id: string;
      windowId: string;
      index: number;
      url: string;
      title: string;
      private: boolean;
      active: boolean;
      focused: boolean;
      muted: boolean;
      audible: boolean;
    }[],
  ) => invoke("extensions_layout", { tabs }),
  /** Answers an extension compatibility request or delivers an extension event. */
  compat: (operation: "compat-reply" | "compat-event", payload: Record<string, unknown>) =>
    invoke("extensions_compat", { operation, payload }),
  respond: (requestId: string, allowed: boolean) =>
    invoke("extensions_respond", { requestId, allowed }),
  tabCreated: (requestId: string, tabId: string) =>
    invoke("extensions_tab_created", { requestId, tabId }),
  /** Floats an extension's popup page in a small window of its own. */
  popupOpen: (tab: string, title: string, width: number, height: number) =>
    invoke<string>("extension_popup_open", { tab, title, width, height }),
  popupClose: (host: string) => invoke<void>("extension_popup_close", { host }),
  /**
   * Downloads and checks an extension's current package for review. `id` is an
   * extension ID, or a Firefox Add-ons slug from the add-on's page.
   */
  prepare: (id: string) => invoke<ExtensionReview>("extensions_prepare", { id }),
  commit: (token: string, generation: string | null = null, privateAccess = false) =>
    invoke<ExtensionReview>("extensions_commit", { token, generation, privateAccess }),
  /** Records access granted on this device; synced settings alone cannot widen it. */
  approve: (guid: string, permissions: string[], hosts: string[], privateAccess: boolean) =>
    invoke<void>("extensions_approve", { guid, permissions, hosts, privateAccess }),
  reconcile: (account: string, installations: Installation[], agentAccess: boolean) =>
    invoke<InstalledState[]>("extensions_reconcile", { account, installations, agentAccess }),
  actions: (tabId: string) =>
    invoke<{ actions: ExtensionAction[] }>("extensions_action", { operation: "actions", tabId }),
  invoke: (id: string, tabId: string, anchor: Pick<DOMRect, "x" | "y" | "width" | "height">) =>
    invoke("extensions_action", { operation: "invoke", id, tabId, anchor }),
  options: (id: string) => invoke("extensions_action", { operation: "options", id }),
  updates: () => invoke<InstalledState[]>("extensions_check_updates"),
};
