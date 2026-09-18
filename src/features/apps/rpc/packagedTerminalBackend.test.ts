import { expect, it, vi } from "vitest";
import { createPackagedTerminalBackend } from "./packagedTerminalBackend";
function fixture() {
  const invoke = vi
    .fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
    .mockResolvedValue(null);
  const authorize = vi.fn(async () => undefined);
  const instance = vi.fn(async () => "owned-instance");
  return {
    invoke,
    authorize,
    instance,
    backend: createPackagedTerminalBackend(
      {
        invoke: <T>(command: string, args?: Record<string, unknown>) =>
          invoke(command, args) as Promise<T>,
        listen: vi.fn(),
      },
      { authorize, instance },
    ),
  };
}
it("does not create a worker when the device grant is denied", async () => {
  const f = fixture();
  f.authorize.mockRejectedValue(new Error("Device access denied"));
  await expect(f.backend.invoke("terminal_create", { request: {} })).rejects.toThrow(
    "Device access denied",
  );
  expect(f.invoke).not.toHaveBeenCalled();
});
it("keeps caller instance fields out of worker authority and allows cleanup without another grant", async () => {
  const f = fixture();
  await f.backend.invoke("terminal_write", {
    instance: "foreign",
    sessionId: "session",
    data: "text",
  });
  expect(f.invoke).toHaveBeenLastCalledWith("terminal_service_call", {
    instance: "owned-instance",
    sessionId: "session",
    command: { operation: "write", data: "text" },
  });
  f.authorize.mockRejectedValue(new Error("revoked"));
  await f.backend.invoke("terminal_kill", { sessionId: "session" });
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.invoke).toHaveBeenLastCalledWith("terminal_service_close", {
    instance: "owned-instance",
    sessionId: "session",
  });
});
it("uses structured SSH requests and rejects unknown native commands", async () => {
  const f = fixture();
  const connection = { kind: "direct", host: "example.test", port: 22 };
  await f.backend.invoke("terminal_ssh_preflight", { connection });
  expect(f.authorize).toHaveBeenCalledOnce();
  expect(f.invoke).toHaveBeenLastCalledWith("terminal_service_request", {
    instance: "owned-instance",
    command: { operation: "sshPreflight", connection },
  });
  await expect(f.backend.invoke("constructor")).rejects.toThrow("Unknown terminal");
  expect(f.invoke).toHaveBeenCalledOnce();
});
it("falls back to host terminal_create when packaged service fails", async () => {
  const f = fixture();
  f.invoke.mockImplementation(async (cmd) => {
    if (cmd === "terminal_service_create") throw new Error("Processor verification failed.");
    if (cmd === "terminal_create") return "host-session-123";
    return null;
  });
  const id = await f.backend.invoke("terminal_create", { request: {} });
  expect(id).toBe("host-session-123");
  expect(f.invoke).toHaveBeenCalledWith("terminal_service_create", expect.anything());
  expect(f.invoke).toHaveBeenCalledWith("terminal_create", expect.anything());

  await f.backend.invoke("terminal_write", { sessionId: "host-session-123", data: "ls\n" });
  expect(f.invoke).toHaveBeenLastCalledWith("terminal_write", { sessionId: "host-session-123", data: "ls\n" });

  await f.backend.invoke("terminal_kill", { sessionId: "host-session-123" });
  expect(f.invoke).toHaveBeenLastCalledWith("terminal_kill", { sessionId: "host-session-123" });
});
