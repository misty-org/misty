import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withBuiltinService } from "./builtinService";
const f = vi.hoisted(() => ({
  invoke: vi.fn(),
  account: { id: "account" } as { id: string } | null,
  generation: 1,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke }));
vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => "https://misty.example/api",
}));
vi.mock("@/api/client", () => ({
  readApiSessionGeneration: () => f.generation,
  assertStableApiSession: (generation: number) => {
    if (generation !== f.generation) throw new Error("Account changed");
  },
}));
vi.mock("@/features/auth/runtimeSession", () => ({
  readActiveSavedAccountSession: () => f.account,
  accountScopeResetEvent: "test:account-reset",
}));
beforeEach(() => {
  f.account = { id: "account" };
  f.generation = 1;
  f.invoke.mockReset().mockResolvedValue("instance");
});
afterEach(() => vi.restoreAllMocks());
it("opens bundled workers without catalog, install, or session requests", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const run = vi.fn().mockResolvedValue("result");
  expect(await withBuiltinService("files", "", run)).toBe("result");
  expect(run).toHaveBeenCalledWith("instance");
  expect(f.invoke.mock.calls).toEqual([
    [
      "builtin_service_open",
      {
        tool: "files",
        purpose: "documents",
        owner: { accountId: "account", deployment: "https://misty.example/api" },
      },
    ],
    ["mini_app_close", { instance: "instance" }],
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
it("cancels in-flight work and releases the native lifetime on account reset", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const result = withBuiltinService("files", "", () => {
    started();
    return new Promise(() => {});
  });
  const rejected = expect(result).rejects.toThrow("session changed");
  await ready;
  window.dispatchEvent(new Event("test:account-reset"));
  await rejected;
  expect(f.invoke).toHaveBeenLastCalledWith("mini_app_close", { instance: "instance" });
});
it("closes a worker returned after its request was cancelled", async () => {
  const abort = new AbortController();
  let complete!: (id: string) => void;
  f.invoke.mockImplementation((command) =>
    command === "builtin_service_open"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve(),
  );
  const run = vi.fn();
  const result = withBuiltinService("library", "space", run, abort.signal);
  const rejected = expect(result).rejects.toThrow("session changed");
  await vi.waitFor(() => expect(complete).toBeDefined());
  abort.abort();
  complete("late-instance");
  await rejected;
  expect(run).not.toHaveBeenCalled();
  expect(f.invoke).toHaveBeenLastCalledWith("mini_app_close", { instance: "late-instance" });
});
it("requires an account and releases failed operations", async () => {
  f.account = null;
  await expect(withBuiltinService("files", "", vi.fn())).rejects.toThrow("Sign in");
  expect(f.invoke).not.toHaveBeenCalled();
  f.account = { id: "account" };
  await expect(
    withBuiltinService("files", "", async () => {
      throw new Error("Preview failed");
    }),
  ).rejects.toThrow("Preview failed");
  expect(f.invoke).toHaveBeenLastCalledWith("mini_app_close", { instance: "instance" });
});
