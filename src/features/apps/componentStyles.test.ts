import { afterEach, describe, expect, it, vi } from "vitest";
import { attachComponentStyles, styleComponentDefinition } from "./componentStyles";
import { defineComponentApp, createMistyAppSDK } from "@misty/sdk";

afterEach(() => vi.useRealTimers());
describe("downloaded component stylesheet lifetime", () => {
  it("styles independent shared-session views and cleans failed mounts", async () => {
    const close = vi.fn();
    const unmount = vi.fn();
    const mount = vi.fn(({ root }: { root: HTMLElement }) => {
      root.textContent = "Shared App";
      return { update() {}, unmount };
    });
    const definition = styleComponentDefinition(
      defineComponentApp({
        appId: "code",
        protocol: 2,
        mount: () => {
          throw new Error("Unexpected direct mount");
        },
        createSession: () => ({ mount, close }),
      }),
      new URL("misty-extension://localhost/public/code/web/app.css?version=verified"),
    );
    const session = await definition.createSession!({ signal: new AbortController().signal });
    const start = () => {
      const root = document.createElement("div");
      const pending = session.mount({
        root,
        signal: new AbortController().signal,
        misty: createMistyAppSDK({ request: async () => null }),
        context: {
          instanceId: "view",
          route: "/apps/code",
          active: true,
          appearance: { mode: "dark" },
        },
      });
      return { root, pending };
    };
    const a = start(),
      b = start();
    expect(mount).not.toHaveBeenCalled();
    for (const view of [a, b]) {
      expect(view.root.querySelector("link")!.href).toContain("version=verified");
      view.root.querySelector("link")!.dispatchEvent(new Event("load"));
    }
    const [first, second] = await Promise.all([a.pending, b.pending]);
    expect(mount).toHaveBeenCalledTimes(2);
    await first.unmount();
    expect(a.root.children).toHaveLength(0);
    expect(b.root.textContent).toBe("Shared App");
    expect(close).not.toHaveBeenCalled();
    await second.unmount();
    expect(b.root.children).toHaveLength(0);
    const failed = start();
    const rejection = expect(failed.pending).rejects.toThrow(/could not be loaded/);
    failed.root.querySelector("link")!.dispatchEvent(new Event("error"));
    await rejection;
    expect(failed.root.children).toHaveLength(0);
    expect(mount).toHaveBeenCalledTimes(2);
    await session.close();
    expect(close).toHaveBeenCalledOnce();
  });
  it("waits for the signed package stylesheet and removes it when the owner closes", async () => {
    const root = document.createElement("div");
    const controller = new AbortController();
    const style = attachComponentStyles(
      root,
      new URL("misty-extension://localhost/public/terminal/web/app.css?version=verified"),
      controller.signal,
    );
    const link = root.querySelector("link")!;
    expect(link.href).toContain("version=verified");
    link.dispatchEvent(new Event("load"));
    await style.ready;
    expect(root.children).toHaveLength(1);
    controller.abort();
    expect(root.children).toHaveLength(0);
    style.dispose();
  });
  it("rejects aborts, failed loads and hung loads without leaving styles behind", async () => {
    const root = document.createElement("div");
    const controller = new AbortController();
    controller.abort();
    const aborted = attachComponentStyles(
      root,
      new URL("https://example.com/app.css"),
      controller.signal,
    );
    await expect(aborted.ready).rejects.toThrow(/closed/);
    const failed = attachComponentStyles(root, new URL("https://example.com/app.css"));
    root.querySelector("link")!.dispatchEvent(new Event("error"));
    await expect(failed.ready).rejects.toThrow(/could not be loaded/);
    vi.useFakeTimers();
    const hung = attachComponentStyles(root, new URL("https://example.com/app.css"));
    const rejected = expect(hung.ready).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(root.children).toHaveLength(0);
  });
});
