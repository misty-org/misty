import {
  CLOSE_CODES,
  MistyError,
  requestTransport,
  webSocketTransport,
  type OpenRequest,
  type RequestTransport,
  type TokenSource,
  type Transport,
  type TransportConnection,
  type TransportEvents,
} from "@misty/sdk";
import { resolveApiBase } from "@/api/deployment/api";
import { collabAddress } from "@/api/deployment/collab_address";
import { invoke } from "@/native/invoke";

const SIGNED_OUT = "signed_out";

export type RoomTransport = Transport & { request: RequestTransport };

function roomToken(apiBase: string): TokenSource {
  return async (options) => {
    try {
      return await invoke<string>("auth_room_token", { apiBase, fresh: options?.fresh === true });
    } catch (error) {
      if (String(error) === SIGNED_OUT)
        throw new MistyError("permission_denied", "Sign in to Misty again to open this room.");
      throw error;
    }
  };
}

function renewedOnRefusal(transport: Transport): Transport {
  return {
    open(request: OpenRequest, events: TransportEvents): TransportConnection {
      let current: TransportConnection | null = null;
      let admitted = false;
      let renewed = request.fresh === true;
      let closed = false;
      const start = (asked: OpenRequest) => {
        current = transport.open(asked, {
          opened(said) {
            if (closed) return;
            admitted = true;
            events.opened(said);
          },
          binary(frame) {
            if (!closed) events.binary(frame);
          },
          text(message) {
            if (!closed) events.text(message);
          },
          closed(code, reason) {
            if (closed) return;
            if (code === CLOSE_CODES.unauthorized && !admitted && !renewed) {
              renewed = true;
              start({ ...asked, fresh: true });
              return;
            }
            events.closed(code, reason);
          },
        });
      };
      start(request);
      return {
        sendBinary: (frame) => current?.sendBinary(frame),
        sendText: (message) => current?.sendText(message),
        close() {
          if (closed) return;
          closed = true;
          current?.close();
        },
      };
    },
  };
}

const transports = new Map<string, RoomTransport>();

export async function roomTransport(): Promise<RoomTransport> {
  const apiBase = await resolveApiBase();
  if (!apiBase) throw new MistyError("closed", "Choose a server before opening a room.");
  const address = await collabAddress(apiBase);
  const key = `${apiBase}\n${address}`;
  const known = transports.get(key);
  if (known) return known;
  const token = roomToken(apiBase);
  const made: RoomTransport = {
    ...renewedOnRefusal(webSocketTransport({ url: address, token })),
    request: requestTransport({ url: address, token }),
  };
  transports.set(key, made);
  return made;
}
