import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import { createAppRpcScope } from "./session";
import { createCodeLspRpc } from "./codeLsp";
import { createSdkCodeLspTransport } from "@/features/coding-workspace/lsp/sdkTransport";
import { LspClient } from "@/features/coding-workspace/lsp/client";
function fixture(scopes = ["code.execute"]) {
  let account = "a";
  const scope = createAppRpcScope({
    identity: { appId: "code", accountId: "a", spaceId: "space", instanceId: crypto.randomUUID() },
    scopes,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: (id) => id === account,
  });
  const events = new Map<string, (value: unknown) => void>();
  const removed = vi.fn();
  const invoke = vi.fn(
    async (_command: string, _args?: Record<string, unknown>): Promise<any> => null,
  );
  const listen = vi.fn(async (name: string, callback: (value: unknown) => void) => {
    events.set(name, callback);
    return removed;
  });
  const rpc = createCodeLspRpc(scope, { invoke, listen });
  const sdk = createMistyAppSDK({
    request: (request) =>
      request.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(request),
    subscribe: rpc.subscribe,
  });
  const emit = (id: string, message: unknown) =>
    events.get("misty://code-lsp-message")?.({ sessionId: id, payload: JSON.stringify(message) });
  return {
    scope,
    rpc,
    sdk,
    events,
    emit,
    invoke,
    removed,
    switchAccount: () => {
      account = "b";
    },
  };
}
it("runs the editor initialize/hover protocol through the SDK and an owned host process", async () => {
  const f = fixture();
  f.invoke.mockImplementation(async (command, args) => {
    if (command === "code_lsp_start") return "native-private";
    if (command === "code_lsp_send") {
      const request = JSON.parse(args!.payload as string);
      if (request.id)
        f.emit("native-private", {
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? { capabilities: { hoverProvider: true } }
              : { contents: "int answer" },
        });
    }
  });
  const client = new LspClient("cpp", "/tmp/sdk #?.project", createSdkCodeLspTransport(f.sdk));
  await client.ensureStarted();
  expect(
    await client.request("textDocument/hover", {
      textDocument: { uri: "file:///tmp/sdk%20%23%3F.project/main.cpp" },
      position: { line: 0, character: 2 },
    }),
  ).toEqual({ contents: "int answer" });
  const sent = f.invoke.mock.calls
    .filter(([command]) => command === "code_lsp_send")
    .map(([, args]) => JSON.parse(args!.payload as string));
  expect(sent[0].params.rootUri).toBe("file:///tmp/sdk%20%23%3F.project");
  expect(sent[1].method).toBe("initialized");
  await client.dispose();
  expect(f.invoke).toHaveBeenCalledWith("code_lsp_stop", { sessionId: "native-private" });
  f.scope.close();
});
it("retains early owned messages and exits while withholding unrelated process events", async () => {
  const f = fixture();
  f.invoke.mockImplementation(async (command) => {
    if (command !== "code_lsp_start") return null;
    f.emit("foreign", { jsonrpc: "2.0", method: "private" });
    f.emit("native", { jsonrpc: "2.0", method: "window/logMessage", params: { message: "ready" } });
    f.events.get("misty://code-lsp-exit")!({ sessionId: "native", reason: "done" });
    return "native";
  });
  const { handle } = await f.sdk.code.lsp.start("cpp", "/tmp");
  expect(handle).not.toBe("native");
  const listener = vi.fn();
  await f.sdk.code.lsp.subscribe(handle, listener);
  expect(listener.mock.calls.map(([event]) => event.type)).toEqual(["message", "exit"]);
  expect(listener.mock.calls[0][0].payload).not.toContain("private");
  await expect(f.sdk.code.lsp.send(handle, '{"jsonrpc":"2.0","method":"exit"}')).rejects.toThrow(
    "exited",
  );
  f.scope.close();
});
it("denies missing permission and foreign handles and cancels late startup on account change", async () => {
  const denied = fixture([]);
  await expect(denied.sdk.code.lsp.start("cpp", "/tmp")).rejects.toThrow("code.execute");
  expect(denied.invoke).not.toHaveBeenCalled();
  denied.scope.close();
  const f = fixture();
  let finish!: (id: string) => void;
  f.invoke.mockImplementation(async (command) =>
    command === "code_lsp_start"
      ? new Promise<string>((resolve) => {
          finish = resolve;
        })
      : null,
  );
  const pending = f.sdk.code.lsp.start("cpp", "/tmp");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.switchAccount();
  finish("late");
  await expect(pending).rejects.toThrow("account changed");
  expect(f.invoke).toHaveBeenCalledWith("code_lsp_stop", { sessionId: "late" });
  expect(f.removed).toHaveBeenCalledTimes(2);
  const foreign = fixture();
  await expect(foreign.sdk.code.lsp.stop("guessed-native-id")).rejects.toThrow("another view");
  expect(foreign.invoke).not.toHaveBeenCalled();
  foreign.scope.close();
});
it("bounds concurrent processes and cleans subscriptions on close", async () => {
  const f = fixture();
  let sequence = 0;
  f.invoke.mockImplementation(async (command) =>
    command === "code_lsp_start" ? `native-${++sequence}` : null,
  );
  const sessions = await Promise.all(
    Array.from({ length: 8 }, () => f.sdk.code.lsp.start("cpp", "/tmp")),
  );
  await expect(f.sdk.code.lsp.start("cpp", "/tmp")).rejects.toThrow("eight");
  await f.sdk.code.lsp.stop(sessions[0].handle);
  await f.sdk.code.lsp.start("rust", "/tmp");
  f.scope.close();
  await vi.waitFor(() =>
    expect(f.invoke.mock.calls.filter(([command]) => command === "code_lsp_stop")).toHaveLength(9),
  );
  expect(f.removed).toHaveBeenCalledTimes(2);
});
it("terminates on queue overflow instead of silently dropping language-server responses", async () => {
  const f = fixture();
  f.invoke.mockResolvedValue("native");
  const { handle } = await f.sdk.code.lsp.start("cpp", "/tmp");
  for (let id = 0; id < 257; id++) f.emit("native", { jsonrpc: "2.0", id, result: null });
  const listener = vi.fn();
  await f.sdk.code.lsp.subscribe(handle, listener);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0][0]).toMatchObject({
    type: "exit",
    reason: expect.stringContaining("buffer"),
  });
  expect(f.invoke).toHaveBeenCalledWith("code_lsp_stop", { sessionId: "native" });
  f.scope.close();
});

it("removes a successful listener when the second native subscription fails", async () => {
  const scope = createAppRpcScope({
    identity: { appId: "code", accountId: "a", instanceId: "view" },
    scopes: ["code.execute"],
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: () => true,
  });
  const remove = vi.fn();
  const invoke = vi.fn(async () => "unexpected");
  const rpc = createCodeLspRpc(scope, {
    invoke: invoke as any,
    listen: async (event) => {
      if (event.endsWith("-exit")) throw new Error("listener failed");
      return remove;
    },
  });
  await expect(
    rpc.request({ method: "code.lsp.start", params: { language: "cpp", cwd: "/tmp" } }),
  ).rejects.toThrow("listener failed");
  expect(remove).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
  scope.close();
});
