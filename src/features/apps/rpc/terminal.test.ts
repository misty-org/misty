import { createMistyAppSDK } from "@misty/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAppRpcScope } from "./session";
import { createTerminalRpc } from "./terminal";

function fixture(scopes = ["terminal.execute"]) {
  let account = "account-a";
  const scope = createAppRpcScope({
    identity: { appId: "terminal", accountId: "account-a", instanceId: "tab-a" },
    scopes,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    isCurrentAccount: (id) => id === account,
  });
  const listeners = new Map<string, (payload: unknown) => void>();
  const removals = [vi.fn(), vi.fn()];
  const backend = {
    invoke: vi.fn(
      async (_command: string, _args?: Record<string, unknown>): Promise<any> => undefined,
    ),
    listen: vi.fn(async (event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
      return removals[listeners.size - 1];
    }),
  };
  const rpc = createTerminalRpc(scope, backend);
  const sdk = createMistyAppSDK({
    request: (request) =>
      request.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(request),
    subscribe: rpc.subscribe,
  });
  return {
    sdk,
    rpc,
    backend,
    listeners,
    removals,
    scope,
    switchAccount: () => {
      account = "account-b";
    },
  };
}

describe("Terminal SDK to host RPC", () => {
  it("keeps native ids private, preserves early output, and routes writes/resizes through owned handles", async () => {
    const f = fixture();
    f.backend.invoke.mockImplementation(async (command) => {
      if (command !== "terminal_create") return;
      expect(f.backend.listen).toHaveBeenCalledTimes(2);
      f.listeners.get("misty://terminal-output")!({ sessionId: "native-a", data: "prompt> " });
      f.listeners.get("misty://terminal-output")!({
        sessionId: "another-app",
        data: "private output",
      });
      return "native-a";
    });
    const session = await f.sdk.terminal.create({
      cols: 100,
      rows: 30,
      env: { LANG: "en_US.UTF-8" },
    });
    expect(session.handle).not.toBe("native-a");
    const output = vi.fn();
    const unsubscribe = await f.sdk.terminal.subscribe(session.handle, output);
    expect(output.mock.calls).toEqual([[{ type: "output", data: "prompt> " }]]);
    await f.sdk.terminal.write(session.handle, "printf test\r");
    await f.sdk.terminal.resize(session.handle, { cols: 120, rows: 40 });
    expect(f.backend.invoke).toHaveBeenCalledWith("terminal_write", {
      sessionId: "native-a",
      data: "printf test\r",
    });
    expect(f.backend.invoke).toHaveBeenCalledWith("terminal_resize", {
      sessionId: "native-a",
      cols: 120,
      rows: 40,
    });
    f.listeners.get("misty://terminal-output")!({
      sessionId: "another-app",
      data: "still private",
    });
    expect(output).toHaveBeenCalledTimes(1);
    unsubscribe();
    await f.sdk.terminal.close(session.handle);
    expect(f.backend.invoke).toHaveBeenCalledWith("terminal_kill", { sessionId: "native-a" });
    await expect(f.sdk.terminal.write(session.handle, "later")).rejects.toMatchObject({
      code: "resource_denied",
    });
    await f.rpc.close();
    expect(f.removals.every((remove) => remove.mock.calls.length === 1)).toBe(true);
  });

  it("denies unknown methods, ungranted capabilities, and handles from another instance", async () => {
    const denied = fixture([]);
    await expect(denied.sdk.terminal.create()).rejects.toMatchObject({ code: "capability_denied" });
    expect(denied.backend.invoke).not.toHaveBeenCalled();
    const f = fixture();
    await expect(
      f.rpc.request({
        method: "terminal.invoke",
        params: { command: "ensure_local_access_token" },
      }),
    ).rejects.toMatchObject({ code: "unsupported_method" });
    await expect(f.sdk.terminal.write("foreign-handle", "pwd\r")).rejects.toMatchObject({
      code: "resource_denied",
    });
    await expect(f.sdk.terminal.subscribe("foreign-handle", () => undefined)).rejects.toMatchObject(
      { code: "resource_denied" },
    );
    expect(f.backend.invoke).not.toHaveBeenCalled();
  });

  it("validates native parameter limits before crossing RPC", async () => {
    const f = fixture();
    for (const options of [
      { rows: -1 },
      { cols: 1.5 },
      { pixelWidth: 65536 },
      { env: { "A=B": "x" } },
      { cwd: "bad\0path" },
    ]) {
      await expect(f.sdk.terminal.create(options)).rejects.toMatchObject({
        code: "invalid_params",
      });
    }
    expect(f.backend.invoke).not.toHaveBeenCalled();
  });

  it("kills a terminal whose native creation finishes after its tab closes", async () => {
    const f = fixture();
    let resolvePending!: (value: string) => void;
    const pending = {
      promise: new Promise<string>((resolve) => {
        resolvePending = resolve;
      }),
    };
    f.backend.invoke.mockImplementation(async (command) =>
      command === "terminal_create" ? pending.promise : undefined,
    );
    const creation = f.sdk.terminal.create();
    const rejected = expect(creation).rejects.toMatchObject({ code: "app_closed" });
    await vi.waitFor(() =>
      expect(f.backend.invoke).toHaveBeenCalledWith("terminal_create", { request: { env: {} } }),
    );
    await f.rpc.close();
    resolvePending("late-native");
    await rejected;
    expect(f.backend.invoke).toHaveBeenCalledWith("terminal_kill", { sessionId: "late-native" });
  });

  it("stops events and requests after account change or session expiry", async () => {
    const f = fixture();
    f.backend.invoke.mockResolvedValue("native-a");
    const { handle } = await f.sdk.terminal.create();
    const output = vi.fn();
    await f.sdk.terminal.subscribe(handle, output);
    f.switchAccount();
    f.listeners.get("misty://terminal-output")!({ sessionId: "native-a", data: "secret" });
    expect(output).not.toHaveBeenCalled();
    await expect(f.sdk.terminal.write(handle, "pwd\r")).rejects.toMatchObject({
      code: "account_changed",
    });
    await f.rpc.close();
    const expired = fixture();
    expired.scope.refresh({ scopes: ["terminal.execute"], expiresAt: new Date(0).toISOString() });
    await expect(expired.sdk.terminal.create()).rejects.toMatchObject({ code: "session_expired" });
  });

  it("cleans up a partial event setup failure and can retry", async () => {
    const f = fixture();
    const remove = vi.fn();
    f.backend.listen
      .mockResolvedValueOnce(remove)
      .mockRejectedValueOnce(new Error("listener failed"));
    await expect(f.sdk.terminal.create()).rejects.toThrow("listener failed");
    expect(remove).toHaveBeenCalledOnce();
    expect(f.backend.invoke).not.toHaveBeenCalled();
    f.backend.listen.mockResolvedValue(vi.fn());
    f.backend.invoke.mockResolvedValue("native-retry");
    await expect(f.sdk.terminal.create()).resolves.toHaveProperty("handle");
    await f.rpc.close();
  });
});
