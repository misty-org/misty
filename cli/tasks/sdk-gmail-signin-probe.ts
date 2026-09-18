/** Manual CUA check of the public Gmail link using production native and host popup routing.
 * Run only in sdk_package_probe, which supplies disposable profiles and app data.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createBrowserRpcBackend } from "../../src/features/apps/rpc/browserBackend";
import { createAppRpcScope } from "../../src/features/apps/rpc/session";
import { useWorkspaceStore } from "../../src/features/workspace/useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "../../src/features/workspace/routeSurface";
import { openBrowserPopup } from "@/features/browser/openBrowserPopup";
import type { WorkspaceTab } from "../../src/features/workspace/model";

const nonce = new URLSearchParams(location.search).get("nonce")!;
const root = document.getElementById("page")!;
const status = document.getElementById("status")!;
const log = (message: string) => {
  status.textContent = message;
  void invoke("sdk_probe_log", { nonce, message });
};
window.addEventListener("error", (event) => log(`ERROR: ${event.message}`));
window.addEventListener("unhandledrejection", (event) => log(`ERROR: ${String(event.reason)}`));
useWorkspaceStore.getState().reset();
const source = useWorkspaceStore
  .getState()
  .openSurface(workspaceSurfaceFromRoute("/apps/inbox?provider=google")!);
let current: { backend: ReturnType<typeof createBrowserRpcBackend>; id: string } | undefined;
document.getElementById("landing")!.onclick = () => {
  if (current)
    void current.backend.navigate(current.id, "https://workspace.google.com/intl/en-US/gmail/");
};
async function open(
  tab: WorkspaceTab,
  url: string,
  provider?: { id: "google"; accountId: string },
) {
  const scope = createAppRpcScope({
    identity: { appId: provider ? "inbox" : "browser", accountId: nonce, instanceId: tab.id },
    scopes: ["browser.navigate", "browser.inspect", "browser.interact"],
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    isCurrentAccount: () => true,
  });
  const backend = createBrowserRpcBackend(scope, root, location.origin);
  if (current) await current.backend.hide(current.id);
  const rect = root.getBoundingClientRect();
  const id = crypto.randomUUID();
  await backend.create({
    id,
    scopeId: crypto.randomUUID(),
    url,
    provider,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    nativeLiveResize: true,
  });
  current = { backend, id };
}
await listen<{ sourceId: string; url: string; popupInstanceKey?: string }>(
  "misty://browser-popup",
  ({ payload }) => {
    const tab = openBrowserPopup(payload);
    log(`Popup received; host ${tab ? "accepted" : "rejected"}: ${new URL(payload.url).hostname}`);
    if (tab) void open(tab, payload.url);
  },
);
await listen<{ url: string; phase: string }>("misty://browser-page", ({ payload }) => {
  const url = new URL(payload.url);
  log(`${payload.phase}: ${url.hostname}${url.pathname}`);
});
await open(source, "https://workspace.google.com/intl/en-US/gmail/", {
  id: "google",
  accountId: "disposable",
});
await invoke("reveal_main_window");
