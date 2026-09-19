import { expect, it, vi } from "vitest";
import { createFilesHostRpc, type FilesHostBackend } from "./filesHost";
import { createAppRpcScope } from "./session";

function scope(grants = ["files.read"]) {
  return createAppRpcScope({
    identity: { appId: "files", accountId: "owner", instanceId: "view" },
    scopes: grants,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
}
it("resolves a search path to its most specific configured source without exposing other roots", async () => {
  const owner = scope();
  const backend = {
    sources: async () => [
      { id: "home", path: "/Users/test" },
      { id: "documents", path: "/Users/test/Documents" },
    ],
  } as unknown as FilesHostBackend;
  const rpc = createFilesHostRpc(owner, backend);
  try {
    expect(
      await rpc.request({
        method: "files.sources.resolveLocation",
        params: { path: "/Users/test/Documents/Launch" },
      }),
    ).toEqual({ handled: true, value: { sourceId: "documents", relative: ["Launch"] } });
    expect(
      await rpc.request({
        method: "files.sources.resolveLocation",
        params: { path: "/Users/test-other/private" },
      }),
    ).toEqual({ handled: true, value: { unavailable: true } });
  } finally {
    rpc.close();
    owner.close();
  }
});
it("keeps media URL requests scoped and rejects them after the view closes", async () => {
  const owner = scope();
  const previewUrl = vi.fn(async (handle: string) => {
    if (handle !== "owned") throw new Error("File belongs to another view");
    return "asset://localhost/movie.mp4";
  });
  const rpc = createFilesHostRpc(owner, { previewUrl } as unknown as FilesHostBackend);
  expect(await rpc.request({ method: "files.previewUrl", params: { handle: "owned" } })).toEqual({
    handled: true,
    value: "asset://localhost/movie.mp4",
  });
  await expect(
    rpc.request({ method: "files.previewUrl", params: { handle: "other-view" } }),
  ).rejects.toThrow("another view");
  owner.close();
  await expect(
    rpc.request({ method: "files.previewUrl", params: { handle: "owned" } }),
  ).rejects.toThrow();
  expect(previewUrl).toHaveBeenCalledTimes(2);
});
it("does not ask the backend for media without files.read", async () => {
  const owner = scope([]);
  const previewUrl = vi.fn();
  const rpc = createFilesHostRpc(owner, { previewUrl } as unknown as FilesHostBackend);
  try {
    await expect(
      rpc.request({ method: "files.previewUrl", params: { handle: "owned" } }),
    ).rejects.toThrow("files.read");
    expect(previewUrl).not.toHaveBeenCalled();
  } finally {
    rpc.close();
    owner.close();
  }
});
