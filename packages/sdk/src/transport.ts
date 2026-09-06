import type { MistySurfaceAdapter } from "./surfaces.js";
/** Host-owned transport injected into a component; never an account credential. */
export interface MistyAppTransport {
  /** Available only in trusted component runtimes; never exposes host stores. */
  registerSurface?(adapter: MistySurfaceAdapter): Promise<() => void>;
  request(message: { method: string; params?: unknown }): Promise<unknown>;
  subscribe?(
    topic: string,
    listener: (event: unknown) => void,
  ): Promise<() => void>;
}

export class MistySDKError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MistySDKError";
  }
}

export type MistyCall = <T>(method: string, params?: unknown) => Promise<T>;
