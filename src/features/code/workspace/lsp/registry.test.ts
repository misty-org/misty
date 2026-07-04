import { expect, it, vi } from "vitest";
import { createCodeLspRegistry } from "./registry";
import type { CodeLspTransport, LspMessage } from "./client";
function transportFixture() {
  let next = 0;
  const receivers = new Map<string, (message: LspMessage) => void>();
  const transport = {
    start: vi.fn(async () => `session-${++next}`),
    send: vi.fn(async (id: string, message: LspMessage) => {
      if (message.method === "initialize")
        receivers.get(id)?.({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
    }),
    stop: vi.fn(async () => undefined),
    subscribe: vi.fn(async (id: string, message: (message: LspMessage) => void) => {
      receivers.set(id, message);
      return () => {
        receivers.delete(id);
      };
    }),
  } satisfies CodeLspTransport;
  return { transport, receivers };
}
it("shares a project's language server only while a Code view retains that project", async () => {
  const f = transportFixture();
  const registry = createCodeLspRegistry(f.transport);
  const first = registry.retainRoot("/project"),
    second = registry.retainRoot("/project");
  const [a, b] = await Promise.all([
    registry.get("typescript", "/project"),
    registry.get("typescript", "/project"),
  ]);
  expect(a).not.toBeNull();
  expect(a).toBe(b);
  expect(f.transport.start).toHaveBeenCalledOnce();
  first();
  expect(f.transport.stop).not.toHaveBeenCalled();
  second();
  await vi.waitFor(() => expect(f.transport.stop).toHaveBeenCalledOnce());
  expect(f.receivers.size).toBe(0);
  registry.close();
});
it("isolates component registries and closes only the aborted owner's sessions", async () => {
  const f = transportFixture();
  const lifetime = new AbortController();
  const a = createCodeLspRegistry(f.transport, lifetime.signal),
    b = createCodeLspRegistry(f.transport);
  const clientA = await a.get("typescript", "/same-project"),
    clientB = await b.get("typescript", "/same-project");
  expect(clientA).not.toBe(clientB);
  lifetime.abort();
  await vi.waitFor(() => expect(f.transport.stop).toHaveBeenCalledWith("session-1"));
  expect(clientB?.isRunning()).toBe(true);
  expect(await a.get("typescript", "/same-project")).toBeNull();
  b.close();
  await vi.waitFor(() => expect(f.receivers.size).toBe(0));
});
it("does not let a released project's late startup overwrite its replacement's status", async () => {
  const f = transportFixture();
  let finish!: (id: string) => void;
  f.transport.start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const registry = createCodeLspRegistry(f.transport);
  const release = registry.retainRoot("/project");
  const old = registry.get("typescript", "/project");
  release();
  const replacement = await registry.get("typescript", "/project");
  finish("old-session");
  await expect(old).resolves.toBeNull();
  await vi.waitFor(() => expect(f.transport.stop).toHaveBeenCalledWith("old-session"));
  expect(replacement?.isRunning()).toBe(true);
  expect(registry.error("typescript", "/project")).toBeNull();
  registry.close();
});
