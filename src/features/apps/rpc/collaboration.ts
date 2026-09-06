import {
  isMistyCollaborationMethod,
  mistyCollaborationContracts,
  JournalTicketSchema,
  MistyCollaborationRoleSchema,
  MistyCollaborationEventSchema,
  MISTY_COLLABORATION_SEND_BYTES,
  MISTY_COLLABORATION_RECEIVE_BYTES,
  type MistyCollaborationResource,
  type MistyCollaborationEvent,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";

export interface CollaborationBackend {
  ticket(
    resource: MistyCollaborationResource,
    resourceId: string,
    signal: AbortSignal,
  ): Promise<unknown>;
  socket(url: string): WebSocket;
}
interface Connection {
  join: AbortController;
  resource: MistyCollaborationResource;
  socket?: WebSocket;
  closed: boolean;
  opened: boolean;
  listeners: Set<(event: MistyCollaborationEvent) => void>;
  pending: MistyCollaborationEvent[];
  pendingBytes: number;
  incomingBytes: number;
  inputQueue: Promise<void>;
  remove: Array<() => void>;
  expiry?: ReturnType<typeof setTimeout>;
}
const capability = (resource: MistyCollaborationResource) =>
  resource === "note" ? "notes.write" : "drawings.write";
const bufferBudget = 32 * 1024 * 1024;
function encode(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function decode(value: string) {
  const text = atob(value);
  if (text.length > MISTY_COLLABORATION_SEND_BYTES)
    throw new AppRpcError("message_too_large", "The collaboration update is too large.");
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
export function collaborationSocketUrl(ticket: unknown, resource: MistyCollaborationResource) {
  const value = JournalTicketSchema.parse(ticket);
  const role = MistyCollaborationRoleSchema.parse(value.role);
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new AppRpcError(
      "invalid_collaboration_ticket",
      "The server returned an invalid collaboration endpoint.",
    );
  }
  const party = resource === "note" ? "note-room" : "drawing-room";
  if (
    !value.ticket ||
    value.ticket.length > 16384 ||
    !value.room ||
    value.room.length > 256 ||
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.endsWith(`/parties/${party}/${encodeURIComponent(value.room)}`) ||
    !Number.isFinite(Date.parse(value.expires_at)) ||
    Date.parse(value.expires_at) <= Date.now()
  )
    throw new AppRpcError(
      "invalid_collaboration_ticket",
      "The server returned an invalid collaboration ticket.",
    );
  url.searchParams.set("ticket", value.ticket);
  url.searchParams.set("_pk", crypto.randomUUID());
  return { url: url.href, role };
}

/** Socket tickets and URLs stay host-owned; only bounded frames cross the SDK. */
export function createCollaborationRpc(scope: AppRpcScope, backend: CollaborationBackend) {
  const connections = new Map<string, Connection>();
  let closed = false;
  const assert = (connection?: Connection) => {
    scope.assert(connection ? capability(connection.resource) : undefined);
    if (closed) throw new AppRpcError("app_closed", "The collaboration runtime has closed.");
  };
  const remove = (handle: string, connection: Connection) => {
    connections.delete(handle);
    connection.closed = true;
    connection.join.abort();
    clearTimeout(connection.expiry);
    connection.listeners.clear();
    connection.pending.length = 0;
    connection.pendingBytes = 0;
    connection.remove.splice(0).forEach((stop) => stop());
    try {
      connection.socket?.close(1000, "App connection closed");
    } catch {
      /* Already closed. */
    }
  };
  const close = () => {
    closed = true;
    for (const [handle, connection] of connections) remove(handle, connection);
  };
  scope.signal.addEventListener("abort", close, { once: true });
  const owned = (handle: string) => {
    const connection = connections.get(handle);
    if (!connection)
      throw new AppRpcError(
        "resource_denied",
        "This collaboration connection does not belong to this App view.",
      );
    assert(connection);
    return connection;
  };
  const emit = (handle: string, connection: Connection, event: MistyCollaborationEvent) => {
    try {
      assert(connection);
    } catch {
      remove(handle, connection);
      return;
    }
    if (!connections.has(handle)) return;
    const parsed = MistyCollaborationEventSchema.parse(event);
    if (connection.listeners.size) {
      for (const listener of connection.listeners) {
        try {
          listener(parsed);
        } catch (error) {
          console.error("Collaboration subscriber failed", error);
        }
      }
    } else {
      const bytes = JSON.stringify(parsed).length;
      if (
        connection.pending.length >= 64 ||
        connection.pendingBytes + connection.incomingBytes + bytes > bufferBudget
      ) {
        remove(handle, connection);
        return;
      }
      connection.pending.push(parsed);
      connection.pendingBytes += bytes;
    }
  };
  const finish = (handle: string, connection: Connection, code: number, reason: string) => {
    if (connection.closed) return;
    connection.closed = true;
    clearTimeout(connection.expiry);
    emit(handle, connection, {
      type: "close",
      code: code >= 1000 && code <= 4999 ? code : 1006,
      reason: reason.slice(0, 240),
    });
    if (connections.has(handle))
      connection.expiry = setTimeout(() => remove(handle, connection), 30_000);
  };
  const fail = (handle: string, connection: Connection, message: string) => {
    if (connection.closed) return;
    emit(handle, connection, { type: "error", message });
    finish(handle, connection, 1006, message);
    try {
      connection.socket?.close(1000, "Collaboration transport failed");
    } catch {
      /* Already closed. */
    }
  };
  return {
    close,
    async request(message: { method: string; params?: unknown }): Promise<unknown> {
      assert();
      if (!isMistyCollaborationMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown collaboration method.");
      const contract = mistyCollaborationContracts[message.method];
      const params = contract.params.parse(message.params ?? {});
      if (message.method === "collaboration.open") {
        const { resource, resourceId } = params as {
          resource: MistyCollaborationResource;
          resourceId: string;
        };
        scope.assert(capability(resource));
        if (!scope.identity.spaceId)
          throw new AppRpcError("space_required", "Open a Space before joining a document.");
        if (connections.size >= 16)
          throw new AppRpcError("resource_limit", "Too many documents are open in this App view.");
        const handle = crypto.randomUUID();
        const connection: Connection = {
          join: new AbortController(),
          resource,
          closed: false,
          opened: false,
          listeners: new Set(),
          pending: [],
          pendingBytes: 0,
          incomingBytes: 0,
          inputQueue: Promise.resolve(),
          remove: [],
        };
        connections.set(handle, connection);
        try {
          connection.expiry = setTimeout(() => connection.join.abort(), 15_000);
          const ticket = await backend.ticket(resource, resourceId, connection.join.signal);
          clearTimeout(connection.expiry);
          assert(connection);
          if (connection.join.signal.aborted)
            throw new AppRpcError("request_cancelled", "The collaboration join was cancelled.");
          if (!connections.has(handle))
            throw new AppRpcError("app_closed", "The App closed before collaboration connected.");
          const target = collaborationSocketUrl(ticket, resource);
          const socket = backend.socket(target.url);
          connection.socket = socket;
          socket.binaryType = "arraybuffer";
          connection.expiry = setTimeout(
            () => fail(handle, connection, "The collaboration connection timed out."),
            15_000,
          );
          const onOpen = () => {
            if (connection.closed || connection.opened) return;
            clearTimeout(connection.expiry);
            connection.opened = true;
            emit(handle, connection, { type: "open" });
          };
          const onError = () => fail(handle, connection, "The collaboration connection failed.");
          const onClose = (event: CloseEvent) => {
            // Server close reasons are not returned: they can contain transport
            // details. The code retains authentication/role failure semantics.
            finish(handle, connection, event.code, "The collaboration connection closed.");
          };
          const onMessage = (event: MessageEvent) => {
            if (connection.closed) return;
            const data: unknown = event.data;
            const size =
              typeof data === "string"
                ? data.length * 2
                : data instanceof ArrayBuffer
                  ? data.byteLength
                  : data instanceof Blob
                    ? data.size
                    : Infinity;
            if (size > MISTY_COLLABORATION_RECEIVE_BYTES) {
              fail(handle, connection, "The collaboration message is too large.");
              return;
            }
            // Bound asynchronous Blob conversions as well as undelivered SDK events.
            connection.incomingBytes += size;
            if (connection.incomingBytes + connection.pendingBytes > bufferBudget) {
              fail(handle, connection, "Collaboration updates arrived too quickly.");
              return;
            }
            connection.inputQueue = connection.inputQueue
              .then(async () => {
                try {
                  if (connection.closed) return;
                  if (typeof data === "string") {
                    if (data.length > MISTY_COLLABORATION_SEND_BYTES) throw new Error("text limit");
                    emit(handle, connection, { type: "text", data });
                  } else {
                    const buffer =
                      data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer);
                    if (!connection.closed)
                      emit(handle, connection, {
                        type: "binary",
                        data: encode(new Uint8Array(buffer)),
                      });
                  }
                } finally {
                  connection.incomingBytes = Math.max(0, connection.incomingBytes - size);
                }
              })
              .catch(() =>
                fail(handle, connection, "The collaboration message could not be read."),
              );
          };
          socket.addEventListener("open", onOpen);
          socket.addEventListener("error", onError);
          socket.addEventListener("close", onClose);
          socket.addEventListener("message", onMessage);
          connection.remove.push(() => {
            socket.removeEventListener("open", onOpen);
            socket.removeEventListener("error", onError);
            socket.removeEventListener("close", onClose);
            socket.removeEventListener("message", onMessage);
          });
          if (socket.readyState === 1) onOpen();
          if (socket.readyState > 1)
            finish(handle, connection, 1006, "The collaboration connection closed.");
          assert(connection);
          return contract.result.parse({ handle, role: target.role });
        } catch (error) {
          remove(handle, connection);
          throw error;
        }
      }
      const { handle, data } = params as { handle: string; data?: string };
      const connection = owned(handle);
      if (message.method === "collaboration.close") {
        remove(handle, connection);
        return undefined;
      }
      if (connection.closed || connection.socket?.readyState !== 1)
        throw new AppRpcError("connection_closed", "The collaboration connection is not open.");
      const bytes = decode(data!);
      if (connection.socket.bufferedAmount + bytes.length > 2 * MISTY_COLLABORATION_SEND_BYTES)
        throw new AppRpcError("backpressure", "The collaboration connection is busy.");
      connection.socket.send(bytes);
      return undefined;
    },
    async subscribe(topic: string, listener: (event: unknown) => void) {
      assert();
      if (!topic.startsWith("collaboration:"))
        throw new AppRpcError("unsupported_topic", "Unknown collaboration topic.");
      const handle = topic.slice("collaboration:".length),
        connection = owned(handle);
      if (connection.listeners.size)
        throw new AppRpcError("resource_limit", "This connection already has a subscriber.");
      connection.listeners.add(listener);
      const pending = connection.pending.splice(0);
      connection.pendingBytes = 0;
      for (const event of pending) emit(handle, connection, event);
      return () => {
        connection.listeners.delete(listener);
      };
    },
  };
}
