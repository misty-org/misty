import { afterEach, expect, it, vi } from "vitest";
import { createCollaborationWebSocket, type MistyCollaborationSDK, type MistyCollaborationEvent } from "@misty/sdk";
import { connectMistyYjs } from "@misty/sdk/yjs";
import * as Y from "yjs";
import * as sync from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(close => close()));
function fixture() {
  let receive: (event: MistyCollaborationEvent) => void = () => {};
  const stop = vi.fn();
  const sdk = {
    open: vi.fn<MistyCollaborationSDK["open"]>(async () => ({ handle: crypto.randomUUID(), role: "editor" })),
    send: vi.fn<MistyCollaborationSDK["send"]>(async () => {}),
    close: vi.fn<MistyCollaborationSDK["close"]>(async () => {}),
    subscribe: vi.fn<MistyCollaborationSDK["subscribe"]>(async (_handle, listener) => { receive = listener; return stop; }),
  };
  const controller = new AbortController(); cleanup.push(() => controller.abort());
  return { sdk, controller, stop, emit: (event: MistyCollaborationEvent) => receive(event) };
}
it("adapts leased RPC to WebSocket events and snapshots outgoing buffers before async sends", async () => {
  const f = fixture();
  const Socket = createCollaborationWebSocket(f.sdk, { resource: "note", resourceId: "note-a", signal: f.controller.signal });
  const socket = new Socket("wss://unused.invalid");
  const opened = vi.fn(), message = vi.fn(); socket.addEventListener("open", opened); socket.addEventListener("message", message);
  await vi.waitFor(() => expect(f.sdk.subscribe).toHaveBeenCalledOnce());
  f.emit({ type: "open" }); expect(opened).toHaveBeenCalledOnce(); expect(socket.readyState).toBe(Socket.OPEN);
  const bytes = new Uint8Array([1, 2]); socket.send(bytes); bytes[0] = 9;
  await vi.waitFor(() => expect(f.sdk.send).toHaveBeenCalledWith(expect.any(String), "AQI="));
  expect(socket.bufferedAmount).toBe(0);
  f.emit({ type: "binary", data: "AwQ=" });
  expect(Array.from(new Uint8Array(message.mock.calls[0][0].data))).toEqual([3, 4]);
  f.controller.abort(); expect(socket.readyState).toBe(Socket.CLOSED); expect(f.stop).toHaveBeenCalledOnce();
  expect(f.sdk.close).toHaveBeenCalledOnce();
  const later = new Socket("wss://unused.invalid"); await Promise.resolve();
  expect(later.readyState).toBe(Socket.CLOSED); expect(f.sdk.open).toHaveBeenCalledOnce();
});
it("cleans a lease returned after close without opening it or subscribing", async () => {
  const f = fixture(); let finish!: () => void;
  f.sdk.open.mockImplementation(async () => { await new Promise<void>(done => { finish = done; }); return { handle: crypto.randomUUID(), role: "editor" }; });
  const Socket = createCollaborationWebSocket(f.sdk, { resource: "drawing", resourceId: "drawing-a", signal: f.controller.signal });
  const socket = new Socket("wss://unused.invalid"); socket.close(); finish();
  await vi.waitFor(() => expect(f.sdk.close).toHaveBeenCalledOnce());
  expect(f.sdk.subscribe).not.toHaveBeenCalled();
});
it("synchronizes real Yjs edits through SDK frames and stops reconnection on abort", async () => {
  const f = fixture(), server = new Y.Doc(), client = new Y.Doc();
  server.getText("body").insert(0, "Server text");
  cleanup.push(() => { server.destroy(); client.destroy(); });
  f.sdk.send.mockImplementation(async (_handle, data) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const decoder = decoding.createDecoder(bytes), encoder = encoding.createEncoder();
    const kind = decoding.readVarUint(decoder);
    if (kind !== 0) return; // Awareness is separate from document synchronization.
    encoding.writeVarUint(encoder, 0);
    sync.readSyncMessage(decoder, encoder, server, "sdk-client");
    const reply = encoding.toUint8Array(encoder);
    if (reply.length > 1) f.emit({ type: "binary", data: btoa(String.fromCharCode(...reply)) });
  });
  const session = await connectMistyYjs(f.sdk, { resource: "note", resourceId: "note-a", doc: client, signal: f.controller.signal });
  cleanup.push(session.destroy);
  await vi.waitFor(() => expect(f.sdk.subscribe).toHaveBeenCalledOnce());
  f.emit({ type: "open" });
  await vi.waitFor(() => expect(client.getText("body").toString()).toBe("Server text"));
  client.getText("body").insert(11, " + client edit");
  await vi.waitFor(() => expect(server.getText("body").toString()).toBe("Server text + client edit"));
  expect(session.provider.disableBc).toBe(true);
  f.controller.abort();
  expect(session.provider.shouldConnect).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(f.sdk.open).toHaveBeenCalledOnce();
  expect(f.sdk.close).toHaveBeenCalledOnce();
});
