import {
  mistyCodeLspContracts,
  MistyLspEventSchema,
  type MistyLspLanguage,
  type MistyLspEvent,
} from "@misty/contracts";
import {
  MistySDKError,
  type MistyCall,
  type MistyAppTransport,
} from "./transport.js";
export {
  isMistyCodeLspMethod,
  mistyCodeLspContracts,
  MistyLspEventSchema,
} from "@misty/contracts";
export type { MistyLspLanguage, MistyLspEvent } from "@misty/contracts";
export interface MistyCodeLspSDK {
  start(language: MistyLspLanguage, cwd: string): Promise<{ handle: string }>;
  send(handle: string, payload: string): Promise<void>;
  stop(handle: string): Promise<void>;
  subscribe(
    handle: string,
    listener: (event: MistyLspEvent) => void,
  ): Promise<() => void>;
}
export function createCodeLspSDK(
  call: MistyCall,
  transport: MistyAppTransport,
): MistyCodeLspSDK {
  return Object.freeze({
    async start(language: MistyLspLanguage, cwd: string) {
      const contract = mistyCodeLspContracts["code.lsp.start"];
      return contract.result.parse(
        await call("code.lsp.start", contract.params.parse({ language, cwd })),
      );
    },
    async send(handle: string, payload: string) {
      const contract = mistyCodeLspContracts["code.lsp.send"];
      contract.result.parse(
        await call("code.lsp.send", contract.params.parse({ handle, payload })),
      );
    },
    async stop(handle: string) {
      const contract = mistyCodeLspContracts["code.lsp.stop"];
      contract.result.parse(
        await call("code.lsp.stop", contract.params.parse({ handle })),
      );
    },
    async subscribe(handle: string, listener: (event: MistyLspEvent) => void) {
      mistyCodeLspContracts["code.lsp.stop"].params.parse({ handle });
      if (!transport.subscribe)
        throw new MistySDKError(
          "unsupported_transport",
          "Language-server events are unavailable.",
        );
      return transport.subscribe(`code-lsp:${handle}`, (event) =>
        listener(MistyLspEventSchema.parse(event)),
      );
    },
  });
}
