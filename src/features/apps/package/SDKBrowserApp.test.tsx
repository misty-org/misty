import { act } from "react";
import { fireEvent, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MistyBrowserEvent, MistyComponentContext } from "@misty/sdk";
import definition from "@/features/apps/package/SDKBrowserApp";
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
function fixture(values = new Map<string, unknown>(), route = "/apps/browser") {
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
      "storage.read",
      "storage.write",
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
    setZoom: vi.fn(async (_id: string, _factor: number) => {}),
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
  const setItems = vi.fn(async (_items: unknown) => {});
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
    route,
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
        message.method === "storage.local.keys" ? Promise.resolve([...values.keys()])
          : message.method === "storage.local.get" ? Promise.resolve(values.get((message.params as { key: string }).key) ?? null)
          : message.method === "storage.local.set" ? Promise.resolve(values.set((message.params as { key: string }).key, (message.params as { value: unknown }).value))
          : message.method === "storage.local.delete" ? Promise.resolve(values.delete((message.params as { key: string }).key))
          : message.method === "navigation.setItems" ? setItems(message.params)
          : message.method === "lifecycle.ready"
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
    setItems,
    values,
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

it("pins a titled page, restores its sidebar destination, and unpins without replacing the native view", async () => {
  let first!: ReturnType<typeof fixture>;
  await act(async () => { first = fixture(); await first.mounted.ready; });
  await waitFor(() => expect(within(first.root).getByRole<HTMLButtonElement>("button", { name: "Pin" }).disabled).toBe(false));
  await act(async () => first.emit({ type: "title", title: "(3) Example document" }));
  fireEvent.click(within(first.root).getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(within(first.root).getByRole("button", { name: "Unpin" })).toBeTruthy());
  const pin = [...first.values.values()][0] as { id: string; label: string; url: string };
  expect(pin).toMatchObject({ label: "Example document", url: "https://example.com/" });
  expect(first.setItems).toHaveBeenLastCalledWith({ items: [{ id: `pin-${pin.id}`, label: pin.label, route: `/apps/browser?pin=${pin.id}` }] });
  expect(first.backend.create).toHaveBeenCalledOnce();
  expect(first.backend.reload).not.toHaveBeenCalled();
  expect(first.backend.navigate).not.toHaveBeenCalled();
  await act(async () => first.mounted.close());
  let second!: ReturnType<typeof fixture>;
  await act(async () => { second = fixture(first.values, `/apps/browser?pin=${pin.id}`); await second.mounted.ready; });
  await waitFor(() => expect(second.backend.create).toHaveBeenCalledOnce());
  expect(second.backend.create).toHaveBeenCalledWith(expect.objectContaining({ url: pin.url }));
  await waitFor(() => expect(within(second.root).getByRole<HTMLButtonElement>("button", { name: "Unpin" }).disabled).toBe(false));
  fireEvent.click(within(second.root).getByRole("button", { name: "Unpin" }));
  await waitFor(() => expect(second.values.size).toBe(0));
  expect(second.backend.create).toHaveBeenCalledOnce();
  expect(second.backend.reload).not.toHaveBeenCalled();
  expect(second.backend.navigate).not.toHaveBeenCalled();
  expect(second.errors).toEqual([]);
});

it("keeps pin state in sync across Browser panes and allows retry after a failed save", async () => {
  const values = new Map<string, unknown>();
  let a!: ReturnType<typeof fixture>, b!: ReturnType<typeof fixture>;
  await act(async () => { a = fixture(values); b = fixture(values); await Promise.all([a.mounted.ready, b.mounted.ready]); });
  for (const pane of [a, b]) await waitFor(() => expect(within(pane.root).getByRole<HTMLButtonElement>("button", { name: "Pin" }).disabled).toBe(false));
  vi.spyOn(values, "set").mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
  fireEvent.click(within(a.root).getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(within(a.root).getByRole("alert").textContent).toContain("Storage unavailable"));
  expect(values.size).toBe(0);
  await waitFor(() => expect(within(a.root).getByRole<HTMLButtonElement>("button", { name: "Pin" }).disabled).toBe(false));
  fireEvent.click(within(a.root).getByRole("button", { name: "Pin" }));
  for (const pane of [a, b]) await waitFor(() => expect(within(pane.root).getByRole("button", { name: "Unpin" })).toBeTruthy());
  expect(values.size).toBe(1);
  expect(within(a.root).queryByRole("alert")).toBeNull();
  fireEvent.click(within(b.root).getByRole("button", { name: "Unpin" }));
  for (const pane of [a, b]) await waitFor(() => expect(within(pane.root).getByRole("button", { name: "Pin" })).toBeTruthy());
  expect(values.size).toBe(0);
});
