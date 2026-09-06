import { createMistyAppSDK, type MistyDataDomain } from "@misty/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAppRpcScope } from "./session";
import { createAppUiRpc } from "./appUi";
import { subscribeAppDataChanges } from "./dataEvents";

function fixture(appId = "terminal", grants: string[] = []) {
  let current = true;
  const scope = createAppRpcScope({
    identity: { appId, accountId: "account", instanceId: "tab", spaceId: "space-a" },
    scopes: grants,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: () => current,
  });
  const remove = vi.fn();
  const backend = {
    setTitle: vi.fn(),
    settings: vi.fn(() => ({})),
    reportError: vi.fn(),
    openExternal: vi.fn(async () => {}),
    registerShortcut: vi.fn((_command: unknown, _listener: () => void) => remove),
    subscribeSettings: vi.fn(() => remove),
    confirm: vi.fn(async () => false),
    subscribeData: (domain: MistyDataDomain, listener: () => void) =>
      subscribeAppDataChanges(scope, domain, listener),
  };
  const rpc = createAppUiRpc(scope, backend);
  const sdk = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message),
    subscribe: rpc.subscribe,
  });
  return {
    scope,
    backend,
    sdk,
    remove,
    switchAccount: () => {
      current = false;
    },
  };
}
describe("App UI SDK methods", () => {
  it.each(["notes", "drawings"] as const)(
    "routes %s invalidation without exposing the account event payload",
    async (domain) => {
      const f = fixture("journal", [`${domain}.read`]);
      const callback = vi.fn();
      await f.sdk.data.subscribe(domain, callback);
      const singular = domain === "notes" ? "note" : "drawing";
      window.dispatchEvent(
        new CustomEvent(`misty:space-${singular}-event`, {
          detail: { space_id: "other", type: `${singular}.updated` },
        }),
      );
      expect(callback).not.toHaveBeenCalled();
      window.dispatchEvent(
        new CustomEvent(`misty:space-${singular}-event`, {
          detail: { space_id: "space-a", type: `${singular}.updated`, secret: "never forwarded" },
        }),
      );
      expect(callback).toHaveBeenCalledExactlyOnceWith();
      f.scope.close();
      window.dispatchEvent(
        new CustomEvent(`misty:space-${singular}-event`, {
          detail: { space_id: "space-a", type: `${singular}.updated` },
        }),
      );
      expect(callback).toHaveBeenCalledOnce();
    },
  );
  it("does not deliver a dialog decision after the requesting view closes", async () => {
    const f = fixture("planner");
    let resolve!: (value: boolean) => void;
    f.backend.confirm.mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const decision = f.sdk.dialogs.confirm("Delete this event?", "Planner");
    await vi.waitFor(() => expect(f.backend.confirm).toHaveBeenCalledOnce());
    f.scope.close();
    resolve(true);
    await expect(decision).rejects.toMatchObject({ code: "app_closed" });
  });
  it("limits data refresh events to the granted domain and current Space, then unsubscribes on close", async () => {
    const f = fixture("planner", ["tasks.read"]);
    const callback = vi.fn();
    await f.sdk.data.subscribe("tasks", callback);
    await expect(f.sdk.data.subscribe("calendar", callback)).rejects.toMatchObject({
      code: "capability_denied",
    });
    const send = (space_id: string, type: string) =>
      window.dispatchEvent(
        new CustomEvent("misty:space-coordination-event", {
          detail: { space_id, type, privatePayload: "not-for-the-component" },
        }),
      );
    send("other", "task.updated");
    send("space-a", "calendar.updated");
    expect(callback).not.toHaveBeenCalled();
    send("space-a", "task.updated");
    expect(callback).toHaveBeenCalledExactlyOnceWith();
    f.scope.close();
    send("space-a", "task.updated");
    expect(callback).toHaveBeenCalledOnce();
  });
  it("allows Planner's roadmap commands without granting another App's shortcuts", async () => {
    const planner = fixture("planner");
    const callback = vi.fn();
    await planner.sdk.shortcuts.register("roadmap.undo", callback);
    await planner.sdk.shortcuts.register("planner.create", callback);
    expect(planner.backend.registerShortcut).toHaveBeenCalledTimes(2);
    await expect(planner.sdk.shortcuts.register("terminal.copy", callback)).rejects.toMatchObject({
      code: "capability_denied",
    });
    const terminal = fixture("terminal");
    await expect(terminal.sdk.shortcuts.register("roadmap.undo", callback)).rejects.toMatchObject({
      code: "capability_denied",
    });
    planner.scope.close();
    terminal.scope.close();
  });
  it("validates owned view titles and strips unrelated settings at the contract boundary", async () => {
    const f = fixture();
    await f.sdk.workspace.setTitle("Terminal · project");
    expect(f.backend.setTitle).toHaveBeenCalledWith("Terminal · project");
    await expect(f.sdk.workspace.setTitle("\x1b[31mterminal")).rejects.toThrow();
    expect(f.backend.setTitle).toHaveBeenCalledOnce();
    f.backend.settings.mockReturnValue({ privateHostCredentials: "must never leave host" });
    await expect(f.sdk.settings.snapshot()).rejects.toThrow();
    f.scope.close();
  });
  it("denies external links without a grant and unsafe protocols before native execution", async () => {
    const f = fixture();
    await expect(f.sdk.links.openExternal("https://example.com")).rejects.toMatchObject({
      code: "capability_denied",
    });
    expect(f.backend.openExternal).not.toHaveBeenCalled();
    f.scope.close();
    const allowed = fixture("terminal", ["links.open"]);
    await expect(allowed.sdk.links.openExternal("file:///etc/passwd")).rejects.toThrow();
    await allowed.sdk.links.openExternal("https://example.com");
    expect(allowed.backend.openExternal).toHaveBeenCalledOnce();
    allowed.scope.close();
  });
  it("removes command subscriptions and suppresses stale events across account changes", async () => {
    const f = fixture();
    let event!: () => void;
    f.backend.registerShortcut.mockImplementation((_command: unknown, listener: () => void) => {
      event = listener;
      return f.remove;
    });
    const handler = vi.fn();
    const remove = await f.sdk.shortcuts.register("terminal.search", handler);
    event();
    expect(handler).toHaveBeenCalledOnce();
    f.switchAccount();
    event();
    expect(handler).toHaveBeenCalledOnce();
    expect(f.remove).toHaveBeenCalledOnce();
    remove();
    expect(f.remove).toHaveBeenCalledOnce();
    const other = fixture("journal");
    await expect(other.sdk.shortcuts.register("terminal.search", handler)).rejects.toMatchObject({
      code: "capability_denied",
    });
    expect(other.backend.registerShortcut).not.toHaveBeenCalled();
    other.scope.close();
  });
});
