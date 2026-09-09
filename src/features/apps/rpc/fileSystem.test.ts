import { afterEach, expect, it, vi } from "vitest";
import { createFileSystemRpc } from "./fileSystem";
import { createAppRpcScope } from "./session";
const scopes: ReturnType<typeof createAppRpcScope>[] = [];
function scope(grants = ["files.read", "files.write", "connections.read"]) {
  const value = createAppRpcScope({
    identity: { appId: "custom-file-app", accountId: "a", instanceId: "v" },
    scopes: grants,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: () => true,
  });
  scopes.push(value);
  return value;
}
afterEach(() => scopes.splice(0).forEach((s) => s.close()));
it("uses the existing filesystem IPC and SQLite transfer service with installation scopes", async () => {
  const invoke = vi.fn(async (_command: string, _params?: Record<string, unknown>) => ({
    rows: [],
    totalCount: 0,
  }));
  const request = createFileSystemRpc(scope(), invoke);
  await request({
    method: "fileSystem.listDirectory",
    params: { request: { path: "/Volumes/disk", showHidden: false } },
  });
  expect(invoke).toHaveBeenLastCalledWith("explorer_list_directory", {
    request: { path: "/Volumes/disk", showHidden: false },
  });
  await request({ method: "fileSystem.transfers", params: { filter: { limit: 50 } } });
  expect(invoke).toHaveBeenLastCalledWith("transfers_snapshot", { filter: { limit: 50 } });
  expect(invoke.mock.calls.some(([name]) => name.startsWith("mini_app_"))).toBe(false);
});
it("blocks writes without the installed scope and never accepts arbitrary IPC names", async () => {
  const invoke = vi.fn();
  const request = createFileSystemRpc(scope(["files.read"]), invoke);
  await expect(
    request({
      method: "fileSystem.queueDelete",
      params: { request: { paths: ["/tmp/a"], permanent: false } },
    }),
  ).rejects.toThrow("files.write");
  await expect(request({ method: "fileSystem.terminal_create", params: {} })).rejects.toThrow(
    "not supported",
  );
  expect(invoke).not.toHaveBeenCalled();
});
it("rejects stale views before calls and after in-flight replies", async () => {
  const current = scope();
  const invoke = vi.fn(async () => {
    current.close();
    return [];
  });
  const request = createFileSystemRpc(current, invoke);
  await expect(request({ method: "fileSystem.disks" })).rejects.toThrow();
  await expect(request({ method: "fileSystem.disks" })).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(1);
});
