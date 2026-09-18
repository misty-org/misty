import {
  MistySDKError,
  type MistyAppTransport,
  type MistyCall,
} from "./transport.js";

import {
  parseTerminalParams,
  parseTerminalResult,
  MistyTerminalEventSchema,
  type MistyTerminalMethod,
  type MistyTerminalParams,
  type MistyTerminalResult,
  type MistySSHConnection,
  type MistyTerminalSize,
  type MistyTerminalCreate,
  type MistyTerminalSession,
  type MistyTerminalEvent,
  type MistySSHEnvironment,
  type MistySSHHostKeyStatus,
} from "@misty/contracts";
export type {
  MistySSHConnection,
  MistyTerminalSize,
  MistyTerminalCreate,
  MistyTerminalSession,
  MistyTerminalEvent,
  MistySSHEnvironment,
  MistySSHHostKeyStatus,
} from "@misty/contracts";

export interface MistyTerminalSDK {
  create(options?: MistyTerminalCreate): Promise<MistyTerminalSession>;
  write(handle: string, data: string): Promise<void>;
  resize(handle: string, size: MistyTerminalSize): Promise<void>;
  close(handle: string): Promise<void>;
  subscribe(
    handle: string,
    listener: (event: MistyTerminalEvent) => void,
  ): Promise<() => void>;
  environments(): Promise<MistySSHEnvironment[]>;
  preflight(connection: MistySSHConnection): Promise<MistySSHHostKeyStatus>;
  trustHost(
    connection: MistySSHConnection,
    fingerprint: string,
  ): Promise<MistySSHHostKeyStatus>;
}

export function createTerminalSDK(
  call: MistyCall,
  transport: MistyAppTransport,
): MistyTerminalSDK {
  const request = async <M extends MistyTerminalMethod>(
    method: M,
    params: MistyTerminalParams<M>,
  ): Promise<MistyTerminalResult<M>> =>
    parseTerminalResult(
      method,
      await call(method, parseTerminalParams(method, params)),
    );
  return Object.freeze({
    create: (options: MistyTerminalCreate = {}) =>
      request("terminal.create", options),
    write: (handle: string, data: string) =>
      request("terminal.write", { handle, data }),
    resize: (handle: string, size: MistyTerminalSize) =>
      request("terminal.resize", { handle, ...size }),
    close: (handle: string) => request("terminal.close", { handle }),
    subscribe: async (
      handle: string,
      listener: (event: MistyTerminalEvent) => void,
    ) => {
      if (!transport.subscribe)
        throw new MistySDKError(
          "unsupported_transport",
          "This Misty runtime does not support terminal events.",
        );
      return transport.subscribe(`terminal:${handle}`, (event) =>
        listener(MistyTerminalEventSchema.parse(event)),
      );
    },
    environments: () => request("terminal.environments", {}),
    preflight: (connection: MistySSHConnection) =>
      request("terminal.preflight", { connection }),
    trustHost: (connection: MistySSHConnection, fingerprint: string) =>
      request("terminal.trustHost", { connection, fingerprint }),
  });
}
