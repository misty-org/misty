import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createFilesHostBackend } from "./filesHostBackend";
import { createAppRpcScope } from "./session";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("keeps local folders available when remote and device discovery fail", async () => {
  vi.mocked(invoke).mockImplementation(async (method) => {
    if (method === "app_environment_snapshot")
      return { homeDir: "/Users/test", mountPath: "/mounts" };
    throw new Error("Service unavailable");
  });
  const scope = createAppRpcScope({
    identity: { appId: "files", accountId: "test", instanceId: "view" },
    scopes: ["files.read"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const backend = createFilesHostBackend(scope, {
    serverBase: "https://example.test",
    root: () => null,
    native: vi.fn(async () => null),
    instance: async () => "view",
    navigate: () => {},
  });
  try {
    expect((await backend.sources()).map((s) => [s.id, s.path])).toEqual([
      ["local:home", "/Users/test"],
      ["local:desktop", "/Users/test/Desktop"],
      ["local:documents", "/Users/test/Documents"],
      ["local:downloads", "/Users/test/Downloads"],
    ]);
  } finally {
    backend.close?.();
    scope.close();
  }
});

it("resolves preview URLs only after validating the owning file handle", async () => {
  const scope = createAppRpcScope({
    identity: { appId: "files", accountId: "test", instanceId: "view" },
    scopes: ["files.read"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const native = vi.fn(async (_method: string, params?: unknown) => {
    if ((params as { handle: string }).handle !== "owned") throw new Error("Unknown file grant");
    return null;
  });
  vi.mocked(invoke).mockResolvedValue({ path: "/Users/test/movie.mp4", kind: "file" });
  const backend = createFilesHostBackend(scope, {
    serverBase: "https://example.test",
    root: () => null,
    native,
    instance: async () => "view",
    navigate: () => {},
  });
  try {
    expect(await backend.previewUrl!("owned")).toBe("/Users/test/movie.mp4");
    expect(invoke).toHaveBeenCalledWith("mini_app_host_file", {
      instance: "view",
      operation: "resolve",
      params: { handle: "owned" },
    });
    vi.mocked(invoke).mockClear();
    await expect(backend.previewUrl!("unowned")).rejects.toThrow("Unknown file grant");
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    backend.close?.();
    scope.close();
  }
});
