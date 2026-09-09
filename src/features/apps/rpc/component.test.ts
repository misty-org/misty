import { describe, expect, it, vi } from "vitest";
import { defineComponentApp, type MistyAppSDK } from "@misty/sdk";
import { mountAppComponent } from "./component";
import { createAppRpcScope } from "./session";

const context = {
  instanceId: "tab-a",
  route: "/apps/journal",
  active: true,
  appearance: { mode: "dark" as const },
};
function scope() {
  return createAppRpcScope({
    identity: { appId: "journal", accountId: "user-a", spaceId: "space-a", instanceId: "tab-a" },
    scopes: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    isCurrentAccount: () => true,
  });
}
describe("downloaded component lifetime", () => {
  it("mounts with an injected SDK, updates context and releases exactly once", async () => {
    const root = document.createElement("div");
    const update = vi.fn();
    const unmount = vi.fn();
    const release = vi.fn();
    let sdk!: MistyAppSDK;
    const runtime = mountAppComponent({
      root,
      scope: scope(),
      context,
      release,
      transport: { request: async () => undefined },
      definition: defineComponentApp({
        appId: "journal",
        protocol: 2,
        mount: ({ root, misty }) => {
          sdk = misty;
          root.textContent = "Journal";
          return { update, unmount };
        },
      }),
    });
    await runtime.ready;
    expect(root.textContent).toBe("Journal");
    runtime.update({ ...context, active: false });
    expect(update).toHaveBeenCalledWith({ ...context, active: false });
    await runtime.close();
    await runtime.close();
    expect(root.textContent).toBe("");
    expect(unmount).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    await expect(sdk.context.get()).rejects.toMatchObject({ code: "app_closed" });
  });
  it("detaches pending mounts immediately and cleans up their late result", async () => {
    let finish!: (value: { update(): void; unmount(): void }) => void;
    const root = document.createElement("div");
    const unmount = vi.fn();
    const runtime = mountAppComponent({
      root,
      scope: scope(),
      context,
      release: vi.fn(),
      transport: { request: async () => undefined },
      definition: defineComponentApp({
        appId: "journal",
        protocol: 2,
        mount: async ({ root }) => {
          const result = await new Promise<{ update(): void; unmount(): void }>((resolve) => {
            finish = resolve;
          });
          root.textContent = "Late";
          return result;
        },
      }),
    });
    const rejected = expect(runtime.ready).rejects.toMatchObject({ code: "app_closed" });
    await runtime.close();
    expect(root.childElementCount).toBe(0);
    finish({ update: vi.fn(), unmount });
    await rejected;
    expect(root.textContent).toBe("");
    expect(unmount).toHaveBeenCalledOnce();
  });
  it("applies the newest context after async mounting and refuses identity changes", async () => {
    const update = vi.fn();
    let finish!: () => void;
    const runtime = mountAppComponent({
      root: document.createElement("div"),
      scope: scope(),
      context,
      release: vi.fn(),
      transport: { request: async () => undefined },
      definition: defineComponentApp({
        appId: "journal",
        protocol: 2,
        mount: async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { update, unmount: vi.fn() };
        },
      }),
    });
    runtime.update({ ...context, route: "/apps/journal/drawings", active: false });
    finish();
    await runtime.ready;
    expect(update).toHaveBeenCalledWith({
      ...context,
      route: "/apps/journal/drawings",
      active: false,
    });
    expect(() => runtime.update({ ...context, instanceId: "other-tab" })).toThrow("identity");
    await runtime.close();
  });
  it("cleans up a partial mount when app startup throws", async () => {
    const root = document.createElement("div");
    const release = vi.fn();
    const runtime = mountAppComponent({
      root,
      scope: scope(),
      context,
      release,
      transport: { request: async () => undefined },
      definition: defineComponentApp({
        appId: "journal",
        protocol: 2,
        mount: ({ root }) => {
          root.textContent = "Partial";
          throw new Error("App failed");
        },
      }),
    });
    await expect(runtime.ready).rejects.toThrow("App failed");
    expect(root.childElementCount).toBe(0);
    expect(release).toHaveBeenCalledOnce();
  });
});
