import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type YProvider from "y-partyserver/provider";
import { messageSync } from "y-partyserver/provider";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

export interface FreezeMark {
  asks: number;
  link: number;
}

export interface SyncHold {
  readonly active: boolean;
  readonly asks: number;
  start(): void;
  arm(ms: number, stalled: () => void): void;
  release(replay: boolean): void;
  resendAll(): void;
  resendAfterFreeze(since: FreezeMark, link: number, ms: number): void;
  stop(): void;
}

const asksResend = (decoder: decoding.Decoder) => {
  try {
    return decoding.peekVarUint(decoder) === syncProtocol.messageYjsSyncStep1;
  } catch {
    return false;
  }
};

export function holdSync(provider: YProvider, doc: Y.Doc): SyncHold {
  const syncHandler = provider.messageHandlers[messageSync];
  let held: Uint8Array[] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asks = 0;
  let resendTimer: ReturnType<typeof setTimeout> | undefined;
  provider.messageHandlers[messageSync] = (encoder, decoder, target, emitSynced, type) => {
    if (asksResend(decoder)) {
      asks += 1;
      clearTimeout(resendTimer);
      resendTimer = undefined;
    }
    if (held) {
      held.push(decoding.readTailAsUint8Array(decoder));
      return;
    }
    syncHandler(encoder, decoder, target, emitSynced, type);
  };
  const sendUpdate = provider._updateHandler;
  doc.off("update", sendUpdate);
  provider._updateHandler = (update, origin) => {
    if (!held) sendUpdate(update, origin);
  };
  doc.on("update", provider._updateHandler);
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const resendAll = () => {
    clearTimeout(resendTimer);
    resendTimer = undefined;
    if (held || provider.ws?.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
    provider.ws.send(encoding.toUint8Array(encoder));
  };
  return {
    get active() {
      return held !== null;
    },
    get asks() {
      return asks;
    },
    start() {
      stop();
      held = [];
    },
    arm(ms, stalled) {
      if (!held) return;
      stop();
      timer = setTimeout(() => {
        timer = undefined;
        if (held) stalled();
      }, ms);
    },
    release(replay) {
      stop();
      const queued = held;
      held = null;
      if (!queued || !replay) return;
      for (const message of queued) {
        const encoder = encoding.createEncoder();
        syncHandler(encoder, decoding.createDecoder(message), provider, true, messageSync);
        if (encoding.length(encoder) > 1 && provider.ws?.readyState === WebSocket.OPEN)
          provider.ws.send(encoding.toUint8Array(encoder));
      }
    },
    resendAll,
    resendAfterFreeze(since, link, ms) {
      if (since.link !== link) {
        resendAll();
        return;
      }
      if (asks > since.asks) return;
      clearTimeout(resendTimer);
      resendTimer = setTimeout(resendAll, ms);
    },
    stop() {
      stop();
      clearTimeout(resendTimer);
      resendTimer = undefined;
    },
  };
}
