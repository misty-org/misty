import { afterEach, expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import { createAppRpcScope } from "./session";
import { createCodeLspRpc } from "./codeLsp";
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const run of close.splice(0)) await run();
});
const virtual = "/misty-project/project",
  native = "/private/tmp/日本語 #? project";
const uri = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;
function fixture(scopes = ["code.execute", "files.read"]) {
  const scope = createAppRpcScope({
    identity: { appId: "code", accountId: "a", spaceId: "space", instanceId: crypto.randomUUID() },
    scopes,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const events = new Map<string, (value: unknown) => void>();
  const invoke = vi.fn(
    async (_name: string, _params?: Record<string, unknown>): Promise<unknown> => "native-process",
  );
  const controller = new AbortController(),
    release = vi.fn();
  const resolveProject = vi.fn(async () => ({
    nativeRoot: native,
    signal: controller.signal,
    release,
  }));
  const rpc = createCodeLspRpc(
    scope,
    {
      invoke: async <T>(name: string, params?: Record<string, unknown>) =>
        (await invoke(name, params)) as T,
      listen: async (event, receive) => {
        events.set(event, receive);
        return () => {
          events.delete(event);
        };
      },
    },
    { resolveProject },
  );
  close.push(async () => {
    scope.close();
    await rpc.close();
  });
  return {
    scope,
    invoke,
    controller,
    release,
    resolveProject,
    rpc,
    sdk: createMistyAppSDK({ request: rpc.request, subscribe: rpc.subscribe }),
    emit(payload: object) {
      events.get("misty://code-lsp-message")!({
        sessionId: "native-process",
        payload: JSON.stringify(payload),
      });
    },
  };
}
it("maps startup, early events and requests while keeping native paths out of project URI replies", async () => {
  const f = fixture();
  f.invoke.mockImplementation(async (name) => {
    if (name === "code_lsp_start")
      f.emit({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri: uri(`${native}/a.cpp`), diagnostics: [] },
      });
    return "native-process";
  });
  const { handle } = await f.sdk.code.lsp.start("cpp", virtual);
  expect(f.resolveProject).toHaveBeenCalledWith(virtual, f.scope.signal);
  expect(f.invoke).toHaveBeenCalledWith("code_lsp_start", {
    request: { language: "cpp", cwd: native },
  });
  const received = vi.fn();
  await f.sdk.code.lsp.subscribe(handle, received);
  expect(JSON.parse(received.mock.calls[0][0].payload).params.uri).toBe(uri(`${virtual}/a.cpp`));
  await f.sdk.code.lsp.send(
    handle,
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { rootUri: uri(virtual) },
    }),
  );
  const sent = f.invoke.mock.calls.find(([name]) => name === "code_lsp_send")![1]!;
  expect(JSON.parse(sent.payload as string).params.rootUri).toBe(uri(native));
  f.controller.abort();
  await vi.waitFor(() => expect(f.release).toHaveBeenCalledOnce());
  expect(received.mock.calls[received.mock.calls.length - 1][0]).toMatchObject({ type: "exit" });
  await expect(
    f.sdk.code.lsp.send(handle, JSON.stringify({ jsonrpc: "2.0", method: "initialized" })),
  ).rejects.toThrow("exited");
  await f.sdk.code.lsp.stop(handle);
  await f.rpc.close();
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.invoke.mock.calls.filter(([name]) => name === "code_lsp_stop")).toHaveLength(1);
});
it("requires file access in addition to process execution before resolving a project", async () => {
  const f = fixture(["code.execute"]);
  await expect(f.sdk.code.lsp.start("cpp", virtual)).rejects.toThrow();
  expect(f.resolveProject).not.toHaveBeenCalled();
  expect(f.invoke).not.toHaveBeenCalled();
});
it("stops a late-starting process and releases its project after revocation", async () => {
  const f = fixture();
  let finish!: () => void;
  f.invoke.mockImplementation(async (name) => {
    if (name === "code_lsp_start")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return "native-process";
  });
  const pending = f.sdk.code.lsp.start("cpp", virtual),
    rejected = expect(pending).rejects.toThrow("closed");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.controller.abort();
  finish();
  await rejected;
  expect(f.invoke).toHaveBeenCalledWith("code_lsp_stop", { sessionId: "native-process" });
  expect(f.release).toHaveBeenCalledOnce();
});
