import { createMistyAppSDK, type MistyBrowserEvent } from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserRpc, type BrowserRpcBackend } from "./browser";
import { createAppRpcScope } from "./session";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const bounds = { x: 20, y: 60, width: 500, height: 300 };
function fixture(grants = ["browser.navigate"]) {
  const scope = createAppRpcScope({
    identity: { appId: "browser", accountId: "a", instanceId: crypto.randomUUID() },
    scopes: grants,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  let receive: (event: MistyBrowserEvent) => void = () => undefined;
  const unlisten = vi.fn();
  const backend = {
    initialUrl: () => "https://example.com",
    constrainBounds: vi.fn((value) => value),
    create: vi.fn<BrowserRpcBackend["create"]>(async () => {
      receive({ type: "page", phase: "started", url: "https://example.com" });
    }),
    layout: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    back: vi.fn(async () => {}),
    forward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    inspect: vi.fn<BrowserRpcBackend["inspect"]>(async () => ({
      url: "https://example.com",
      title: "Page",
      text: "Open",
      truncated: false,
      interactive: [{ ref: "element-1-0", tag: "button", role: "", name: "Open" }],
      contentTrust: "untrusted-web-page",
    })),
    click: vi.fn(async () => {}),
    overlay: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    subscribe: vi.fn(async (_id, listener) => {
      receive = listener;
      return unlisten;
    }),
  } satisfies BrowserRpcBackend;
  const rpc = createBrowserRpc(scope, backend);
  const sdk = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message),
    subscribe: rpc.subscribe,
  });
  cleanups.push(async () => {
    scope.close();
    await rpc.close();
  });
  return { sdk, scope, backend, rpc, unlisten, emit: (event: MistyBrowserEvent) => receive(event) };
}
it("uses private native IDs, buffers early events, validates input and rejects another instance's handle", async () => {
  const a = fixture(),
    b = fixture();
  const view = await a.sdk.browser.create({ bounds });
  expect(view.url).toBe("https://example.com");
  const native = a.backend.create.mock.calls[0][0];
  expect(native.id).not.toBe(view.handle);
  expect(native.scopeId).toBe(view.contextId);
  expect(view.contextId).not.toContain(native.id);
  expect(native.bounds).toEqual(bounds);
  const received = vi.fn();
  await a.sdk.browser.subscribe(view.handle, received);
  expect(received).toHaveBeenCalledExactlyOnceWith({
    type: "page",
    phase: "started",
    url: "https://example.com",
  });
  await expect(b.sdk.browser.navigate(view.handle, "https://other.example")).rejects.toMatchObject({
    code: "resource_denied",
  });
  await expect(a.sdk.browser.navigate(view.handle, "file:///private")).rejects.toThrow();
  expect(b.backend.navigate).not.toHaveBeenCalled();
  expect(a.backend.navigate).not.toHaveBeenCalled();
  await a.sdk.browser.navigate(view.handle, "https://other.example");
  expect(a.backend.navigate).toHaveBeenCalledWith(native.id, "https://other.example");
  a.scope.close();
  a.emit({ type: "title", title: "late event" });
  expect(received).toHaveBeenCalledOnce();
  await a.rpc.close();
  await vi.waitFor(() => expect(a.backend.close).toHaveBeenCalledExactlyOnceWith(native.id));
  expect(a.unlisten).toHaveBeenCalledOnce();
});
it("closes a native view that finishes creation after the component closes", async () => {
  const f = fixture();
  let created!: () => void;
  f.backend.create.mockImplementation(
    () =>
      new Promise<void>((done) => {
        created = done;
      }),
  );
  const opening = f.sdk.browser.create({ bounds });
  const rejected = expect(opening).rejects.toMatchObject({ code: "app_closed" });
  await vi.waitFor(() => expect(f.backend.create).toHaveBeenCalledOnce());
  f.scope.close();
  expect(f.backend.hide).toHaveBeenCalledOnce();
  created();
  await rejected;
  expect(f.backend.close).toHaveBeenCalledOnce();
  expect(f.unlisten).toHaveBeenCalledOnce();
});
it("enforces the one-view limit through cleanup and cannot bypass host geometry checks", async () => {
  const f = fixture();
  const view = await f.sdk.browser.create({ bounds });
  await expect(f.sdk.browser.create({ bounds })).rejects.toMatchObject({ code: "resource_limit" });
  f.backend.constrainBounds.mockImplementation(() => {
    throw new Error("outside app view");
  });
  await expect(f.sdk.browser.layout(view.handle, { bounds, visible: true })).rejects.toThrow(
    "outside app view",
  );
  expect(f.backend.layout).not.toHaveBeenCalled();
  await f.sdk.browser.layout(view.handle, { bounds, visible: false });
  expect(f.backend.layout).toHaveBeenCalledOnce();
  let removed!: () => void;
  f.backend.close.mockImplementation(
    () =>
      new Promise<void>((done) => {
        removed = done;
      }),
  );
  const closing = f.sdk.browser.close(view.handle);
  await vi.waitFor(() => expect(f.backend.close).toHaveBeenCalledOnce());
  await expect(f.sdk.browser.create({ bounds })).rejects.toMatchObject({ code: "resource_limit" });
  removed();
  await closing;
  await expect(f.sdk.browser.reload(view.handle)).rejects.toMatchObject({
    code: "resource_denied",
  });
});
it("denies browser creation before any native work without its grant", async () => {
  const f = fixture([]);
  await expect(f.sdk.browser.create({ bounds })).rejects.toMatchObject({
    code: "capability_denied",
  });
  expect(f.backend.create).not.toHaveBeenCalled();
  expect(f.backend.subscribe).not.toHaveBeenCalled();
});

it("requires separate inspection/interaction grants and a fresh owned snapshot for each click", async () => {
  const denied = fixture();
  const deniedView = await denied.sdk.browser.create({ bounds });
  await expect(denied.sdk.browser.inspect(deniedView.handle)).rejects.toMatchObject({
    code: "capability_denied",
  });
  expect(denied.backend.inspect).not.toHaveBeenCalled();
  const f = fixture(["browser.navigate", "browser.inspect", "browser.interact"]);
  const view = await f.sdk.browser.create({ bounds });
  const snapshot = await f.sdk.browser.inspect(view.handle);
  await expect(
    f.sdk.browser.click(view.handle, snapshot.documentId, "unknown"),
  ).rejects.toMatchObject({ code: "document_changed" });
  expect(f.backend.click).not.toHaveBeenCalled();
  await f.sdk.browser.click(view.handle, snapshot.documentId, snapshot.interactive[0].ref);
  expect(f.backend.click).toHaveBeenCalledExactlyOnceWith(
    f.backend.create.mock.calls[0][0].id,
    "element-1-0",
  );
  await expect(
    f.sdk.browser.click(view.handle, snapshot.documentId, "element-1-0"),
  ).rejects.toMatchObject({ code: "document_changed" });
  const next = await f.sdk.browser.inspect(view.handle);
  f.emit({ type: "page", phase: "started", url: "https://example.com/next" });
  await expect(
    f.sdk.browser.click(view.handle, next.documentId, "element-1-0"),
  ).rejects.toMatchObject({ code: "document_changed" });
});

it("rejects inspection results that finish after navigation and invalidates prior snapshots on reload", async () => {
  const f = fixture(["browser.navigate", "browser.inspect", "browser.interact"]);
  const view = await f.sdk.browser.create({ bounds });
  const old = await f.sdk.browser.inspect(view.handle);
  await f.sdk.browser.reload(view.handle);
  await expect(
    f.sdk.browser.click(view.handle, old.documentId, "element-1-0"),
  ).rejects.toMatchObject({ code: "document_changed" });
  const snapshot = f.backend.inspect.mock.results[0].value;
  let finish!: () => void;
  f.backend.inspect.mockImplementation(async () => {
    await new Promise<void>((done) => {
      finish = done;
    });
    return snapshot;
  });
  const pending = f.sdk.browser.inspect(view.handle);
  const rejected = expect(pending).rejects.toMatchObject({ code: "document_changed" });
  await vi.waitFor(() => expect(f.backend.inspect).toHaveBeenCalledTimes(2));
  f.emit({ type: "page", phase: "started", url: "https://example.com/new" });
  finish();
  await rejected;
});
