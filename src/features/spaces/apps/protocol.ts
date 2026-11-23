// The wire protocol of the SDK channel, as the host speaks it. misty-sdk (MIT) owns the other end in
// `packages/sdk/src/protocol.ts`; keep the two in step. The host's end never imports the SDK's code; only Misty's
// own pages do, as the SDK's clients (`page_misty.ts`).

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_VERSIONS: readonly number[] = [1];
export const INIT_MESSAGE = "misty:init";

export type ErrorCode =
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unsupported"
  | "cancelled"
  | "closed"
  | "internal";

export interface WireError {
  code: ErrorCode;
  message: string;
}

export type Frame =
  | { t: "req"; id: number; method: string; params?: unknown }
  | { t: "res"; id: number; ok: true; result?: unknown }
  | { t: "res"; id: number; ok: false; error: WireError }
  | { t: "sub"; id: number; topic: string; params?: unknown }
  | { t: "unsub"; id: number }
  | { t: "evt"; id: number; data: unknown }
  | { t: "end"; id: number; error?: WireError }
  | { t: "mcp"; message: unknown };

export class HostError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "HostError";
    this.code = code;
  }
}

export const toWireError = (error: unknown): WireError =>
  error instanceof HostError
    ? { code: error.code, message: error.message }
    : {
        code: "internal",
        message: error instanceof Error ? error.message : "Something went wrong.",
      };
