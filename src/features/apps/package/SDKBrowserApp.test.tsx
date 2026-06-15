import { act } from "react";
import { fireEvent, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MistyBrowserEvent, MistyComponentContext } from "@misty/sdk";
import definition from "./SDKBrowserApp";
import { mountAppComponent } from "../rpc/component";
import { createAppRpcScope } from "../rpc/session";
import { createBrowserRpc, type BrowserRpcBackend } from "../rpc/browser";
import { createAppUiRpc } from "../rpc/appUi";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await act(close);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
function fixture() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 44, 500, 300),
  );
  const root = document.createElement("div");
  document.body.append(root);
  const scope = createAppRpcScope({
    identity: { appId: "browser", accountId: "user-a", instanceId: crypto.randomUUID() },
    scopes: [
      "browser.navigate",
      "browser.inspect",
      "browser.interact",
      "ai.use",
      "navigation.write",
      "links.open",
      "clipboard.write",
    ],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  let receive: (event: MistyBrowserEvent) => void = () => {};
  const backend = {
    initialUrl: () => "https://example.com",
    constrainBounds: (value) => value,
    create: vi.fn(async () => {
      receive({ type: "page", phase: "finished", url: "https://example.com" });
    }),
    layout: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    back: vi.fn(async () => {}),
    forward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    inspect: vi.fn<BrowserRpcBackend["inspect"]>(async () => ({
      url: "https://example.com",
      title: "Page",
      text: "Page text",
      truncated: false,
      interactive: [],
      contentTrust: "untrusted-web-page",
    })),
    click: vi.fn(async () => {}),
    overlay: vi.fn(async () => {}),
    subscribe: vi.fn(async (_id, listener) => {
      receive = listener;
      return () => {};
    }),
  } satisfies BrowserRpcBackend;
  const browser = createBrowserRpc(scope, backend);
  const errors: string[] = [];
  const setTitle = vi.fn();
  const ui = createAppUiRpc(scope, {
    settings: () => ({ browser: { homeUrl: "https://example.com", searchEngineIndex: 1 } }),
    setTitle,
    subscribeSettings: () => () => {},
    registerShortcut: () => () => {},
    openExternal: async () => {},
    reportError: (error) => errors.push(error),
  });
  const context: MistyComponentContext = {
    instanceId: scope.identity.instanceId,
    route: "/apps/browser",
    active: true,
    focused: true,
    appearance: { mode: "dark" },
  };
  const mounted = mountAppComponent({
    definition,
    root,
    context,
    scope,
    transport: {
      registerSurface: async () => () => {},
      subscribe: (topic, listener) =>
        topic.startsWith("browser:")
          ? browser.subscribe(topic, listener)
          : ui.subscribe(topic, listener),
      request: (message) =>
        message.method === "lifecycle.ready"
          ? Promise.resolve()
          : message.method.startsWith("browser.")
            ? browser.request(message)
            : ui.request(message),
    },
    release: () => {
      ui.close();
      void browser.close();
    },
  });
  cleanups.push(async () => {
    await mounted.close();
    await browser.close();
  });
  return {
    mounted,
    root,
    context,
    backend,
    errors,
    setTitle,
    emit: (event: MistyBrowserEvent) => receive(event),
  };
}
it("mounts through the real SDK/RPC, navigates, updates its title, hides on tab switch and closes its native view", async () => {
  let f!: ReturnType<typeof fixture>;
  await act(async () => {
    f = fixture();
    await f.mounted.ready;
  });
  await waitFor(() => expect(f.backend.create).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(within(f.root).getByRole<HTMLButtonElement>("button", { name: "Reload" }).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(within(f.root).getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(f.backend.reload).toHaveBeenCalledOnce());
  const input = f.root.querySelector("input")!;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "misty sdk" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() =>
    expect(f.backend.navigate).toHaveBeenCalledWith(
      expect.any(String),
      "https://duckduckgo.com/?q=misty%20sdk",
    ),
  );
  await act(async () => {
    f.emit({ type: "title", title: "SDK browser page" });
  });
  expect(f.setTitle).toHaveBeenCalledWith("SDK browser page");
  await act(async () => {
    f.mounted.update({ ...f.context, active: false, focused: false });
  });
  await waitFor(() =>
    expect(f.backend.layout).toHaveBeenCalledWith(expect.objectContaining({ visible: false })),
  );
  expect(f.root.querySelector("iframe")).toBeNull();
  expect(f.errors).toEqual([]);
  await act(async () => {
    await f.mounted.close();
  });
  await waitFor(() => expect(f.backend.close).toHaveBeenCalledOnce());
});
