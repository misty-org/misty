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
