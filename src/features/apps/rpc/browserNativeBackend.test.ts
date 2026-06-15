import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { createAppRpcScope } from "./session";
import { createBrowserRpcBackend } from "./browserBackend";
const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async (command) =>
    command === "browser_webview_reconcile" ? true : undefined,
  ),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  useWorkspaceStore.getState().reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  invoke.mockReset();
  document.body.innerHTML = "";
});
async function fixture() {
  vi.stubGlobal("crypto", webcrypto);
  invoke.mockImplementation(async (command) =>
    command === "browser_webview_reconcile" ? true : undefined,
  );
  const root = document.createElement("div");
  document.body.append(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 50, 500, 300));
  const tab = useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute("/apps/browser")!);
  const scope = createAppRpcScope({
    identity: { appId: "browser", accountId: "fixture", instanceId: tab.id },
    scopes: ["browser.navigate", "browser.inspect", "browser.interact"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const backend = createBrowserRpcBackend(scope, root, "https://example.com/api");
  const id = `sdk-${crypto.randomUUID()}`,
    scopeId = crypto.randomUUID();
  await backend.create({
    id,
    scopeId,
    url: "https://example.com",
    bounds: { x: 0, y: 50, width: 500, height: 300 },
    nativeLiveResize: false,
  });
  cleanups.push(async () => {
    scope.close();
    await backend.close(id);
  });
  return { backend, id, scopeId, scope };
}
it("issues private short-lived native grants and revokes them even when inspection fails", async () => {
  const f = await fixture();
  invoke.mockImplementation(async (command) => {
    if (command === "browser_agent_execute") throw new Error("Page unavailable");
    return command === "browser_webview_reconcile" ? true : undefined;
  });
  await expect(f.backend.inspect(f.id)).rejects.toThrow("Page unavailable");
  const grant = (
    invoke.mock.calls.find(([command]) => command === "browser_agent_grant_register")![1] as {
      request: {
        grantId: string;
        scopeId: string;
        id: string;
        capabilities: string[];
        expiresAt: string;
      };
    }
  ).request;
  expect(grant.scopeId).toBe(f.scopeId);
  expect(grant.capabilities).toEqual(["browser.inspect"]);
  expect(Date.parse(grant.expiresAt) - Date.now()).toBeLessThanOrEqual(30_000);
  expect(invoke).toHaveBeenCalledWith("browser_agent_grant_revoke", {
    request: { id: grant.id, grantId: grant.grantId },
  });
});
it("does not execute a native action if the account closes during grant registration", async () => {
  const f = await fixture();
  let finish!: () => void;
  invoke.mockImplementation(async (command) => {
    if (command === "browser_agent_grant_register")
      await new Promise<void>((done) => {
        finish = done;
      });
    return undefined;
  });
  const action = f.backend.click(f.id, "element-1");
  const rejected = expect(action).rejects.toMatchObject({ code: "app_closed" });
  await vi.waitFor(() =>
    expect(invoke.mock.calls.some(([command]) => command === "browser_agent_grant_register")).toBe(
      true,
    ),
  );
  f.scope.close();
  finish();
  await rejected;
  expect(invoke.mock.calls.some(([command]) => command === "browser_agent_execute")).toBe(false);
  expect(invoke.mock.calls.some(([command]) => command === "browser_agent_grant_revoke")).toBe(
    true,
  );
});
it("releases only the closing view's overlay reasons", async () => {
  const a = await fixture(),
    b = await fixture();
  await a.backend.overlay(a.id, "menu", true);
  await b.backend.overlay(b.id, "menu", true);
  await a.backend.close(a.id);
  expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(true);
  await b.backend.close(b.id);
  await vi.waitFor(() =>
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false),
  );
});
