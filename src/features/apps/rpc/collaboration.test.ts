import { createMistyAppSDK, MISTY_COLLABORATION_SEND_BYTES } from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createCollaborationRpc, collaborationSocketUrl } from "./collaboration";
import { createAppRpcScope } from "./session";
class Socket extends EventTarget {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  });
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  receive(data: ArrayBuffer | string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));
const ticket = () => ({
  ticket: "host-only-join-token",
  room: "room-a",
  url: "wss://collab.example/prefix/parties/note-room/room-a",
  role: "editor",
  expires_at: new Date(Date.now() + 60000).toISOString(),
});
function fixture(grants = ["notes.write", "drawings.write"]) {
  const scope = createAppRpcScope({
    identity: {
      appId: "journal",
      accountId: "a",
      spaceId: "space-a",
      instanceId: crypto.randomUUID(),
    },
    scopes: grants,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const socket = new Socket();
  const backend = {
    ticket: vi.fn(async () => ticket()),
    socket: vi.fn((_url: string) => socket as unknown as WebSocket),
  };
  const rpc = createCollaborationRpc(scope, backend);
  const sdk = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message),
    subscribe: rpc.subscribe,
  });
  cleanup.push(() => {
    scope.close();
    rpc.close();
  });
  return { scope, socket, backend, rpc, sdk };
}
it("keeps tickets/endpoints in the host, buffers early events and exchanges bounded binary frames", async () => {
  const f = fixture();
  const view = await f.sdk.collaboration.open({ resource: "note", resourceId: "note-a" });
  expect(Object.keys(view).sort()).toEqual(["handle", "role"]);
  const url = new URL(f.backend.socket.mock.calls[0][0]);
  expect(url.searchParams.get("ticket")).toBe("host-only-join-token");
  expect(url.pathname).toBe("/prefix/parties/note-room/room-a");
  f.socket.open();
  const events = vi.fn();
  await f.sdk.collaboration.subscribe(view.handle, events);
  expect(events).toHaveBeenCalledExactlyOnceWith({ type: "open" });
  f.socket.receive(Uint8Array.from([0, 1, 255]).buffer);
  await vi.waitFor(() => expect(events).toHaveBeenCalledWith({ type: "binary", data: "AAH/" }));
  await f.sdk.collaboration.send(view.handle, "AAH/");
  expect(Array.from(f.socket.send.mock.calls[0][0])).toEqual([0, 1, 255]);
  f.scope.close();
  expect(f.socket.close).toHaveBeenCalledOnce();
  const count = events.mock.calls.length;
  f.socket.receive("late page data");
  expect(events).toHaveBeenCalledTimes(count);
});
it("denies missing permissions and foreign handles before sending or requesting tickets", async () => {
  const denied = fixture([]);
  await expect(
    denied.sdk.collaboration.open({ resource: "note", resourceId: "note-a" }),
  ).rejects.toMatchObject({ code: "capability_denied" });
  expect(denied.backend.ticket).not.toHaveBeenCalled();
  const a = fixture(),
    b = fixture();
  const view = await a.sdk.collaboration.open({ resource: "note", resourceId: "note-a" });
  a.socket.open();
  await expect(b.sdk.collaboration.send(view.handle, "AA==")).rejects.toMatchObject({
    code: "resource_denied",
  });
  expect(a.socket.send).not.toHaveBeenCalled();
  expect(b.socket.send).not.toHaveBeenCalled();
  a.scope.refresh({ scopes: [], expiresAt: "2099-01-01T00:00:00Z" });
  expect(a.socket.close).toHaveBeenCalledOnce();
});
it("does not create a socket when an app closes while its join ticket is pending", async () => {
  const f = fixture();
  let finish!: () => void;
  f.backend.ticket.mockImplementation(async () => {
    await new Promise<void>((done) => {
      finish = done;
    });
    return ticket();
  });
  const opening = f.sdk.collaboration.open({ resource: "note", resourceId: "note-a" });
  const rejected = expect(opening).rejects.toMatchObject({ code: "app_closed" });
  f.scope.close();
  finish();
  await rejected;
  expect(f.backend.socket).not.toHaveBeenCalled();
});
it("enforces send backpressure and byte limits, and does not expose server close details", async () => {
  const f = fixture();
  const view = await f.sdk.collaboration.open({ resource: "note", resourceId: "note-a" });
  f.socket.open();
  f.socket.bufferedAmount = 2 * MISTY_COLLABORATION_SEND_BYTES;
  await expect(f.sdk.collaboration.send(view.handle, "AA==")).rejects.toMatchObject({
    code: "backpressure",
  });
  f.socket.bufferedAmount = 0;
  await expect(
    f.sdk.collaboration.send(view.handle, btoa("a".repeat(MISTY_COLLABORATION_SEND_BYTES + 1))),
  ).rejects.toThrow();
  expect(f.socket.send).not.toHaveBeenCalled();
  const events = vi.fn();
  await f.sdk.collaboration.subscribe(view.handle, events);
  f.socket.dispatchEvent(new CloseEvent("close", { code: 4403, reason: "private-ticket-value" }));
  expect(events).toHaveBeenCalledWith({
    type: "close",
    code: 4403,
    reason: "The collaboration connection closed.",
  });
  expect(JSON.stringify(events.mock.calls)).not.toContain("private-ticket-value");
});
it("rejects expired tickets, non-websocket URLs and a different resource room", () => {
  for (const patch of [
    { expires_at: "2000-01-01T00:00:00Z" },
    { url: "https://collab.example/parties/note-room/room-a" },
    { url: "wss://collab.example/parties/drawing-room/room-a" },
    { url: "wss://user:password@collab.example/parties/note-room/room-a" },
  ])
    expect(() => collaborationSocketUrl({ ...ticket(), ...patch }, "note")).toThrow();
});
