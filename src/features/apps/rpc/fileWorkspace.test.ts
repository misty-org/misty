import { expect, it, vi } from "vitest";
import { createFileWorkspaceMount } from "./fileWorkspace";
import { createAppRpcScope } from "./session";
it("mounts only inside the calling app, updates destinations, and closes with its session", async () => {
  const scope = createAppRpcScope({
    identity: { appId: "files", accountId: "a", instanceId: "v" },
    scopes: [
      "files.read",
      "files.write",
      "connections.read",
      "connections.write",
      "navigation.write",
    ],
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: () => true,
  });
  const container = document.createElement("div"),
    root = document.createElement("div");
  container.append(root);
  const render = vi.fn();
  const mount = createFileWorkspaceMount(scope, container, render);
  await expect(mount(document.createElement("div"), { view: "explorer" })).rejects.toThrow(
    "inside",
  );
  const workspace = await mount(root, { view: "explorer" });
  workspace.update({ view: "transfers" });
  expect(render).toHaveBeenLastCalledWith({ root, options: { view: "transfers", active: true } });
  await expect(mount(root, { view: "explorer" })).rejects.toThrow("already");
  scope.close();
  expect(render).toHaveBeenLastCalledWith(null);
  expect(() => workspace.update({ view: "explorer" })).toThrow();
  workspace.unmount();
});
