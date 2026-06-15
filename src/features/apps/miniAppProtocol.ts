export const MINI_APP_PROTOCOL_VERSION = 2 as const;

export interface MiniAppRpcRequest<T = unknown> {
  readonly type: "misty:app-rpc";
  readonly protocol: typeof MINI_APP_PROTOCOL_VERSION;
  /** Correlation only. The host never derives App identity from this message. */
  readonly requestId: string;
  readonly method: string;
  readonly params: T;
}

export interface MiniAppRpcResponse<T = unknown> {
  readonly type: "misty:app-rpc-response";
  readonly protocol: typeof MINI_APP_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

/** Portable manifest shape for third-party and first-party Mini Apps. */
export interface MiniAppManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly sdk: string;
  readonly entry: string;
  readonly capabilities: readonly string[];
  readonly networkOrigins?: readonly string[];
}
