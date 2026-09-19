import {
  mistyCollaborationContracts, MistyCollaborationEventSchema,
  type MistyCollaborationEvent, type MistyCollaborationMethod,
  type MistyCollaborationParams, type MistyCollaborationResult,
} from "@misty/contracts";
import { MistySDKError, type MistyCall, type MistyAppTransport } from "./transport.js";

export function createCollaborationSDK(call: MistyCall, transport: MistyAppTransport) {
  const request = async <M extends MistyCollaborationMethod>(method: M, params: MistyCollaborationParams<M>): Promise<MistyCollaborationResult<M>> => {
    const contract = mistyCollaborationContracts[method];
    return contract.result.parse(await call(method, contract.params.parse(params))) as MistyCollaborationResult<M>;
  };
  return Object.freeze({
    open: (params: MistyCollaborationParams<"collaboration.open">) => request("collaboration.open", params),
    send: (handle: string, data: string) => request("collaboration.send", { handle, data }),
    close: (handle: string) => request("collaboration.close", { handle }),
    async subscribe(handle: string, listener: (event: MistyCollaborationEvent) => void) {
      if (!transport.subscribe) throw new MistySDKError("unsupported_transport", "Collaboration events are unavailable.");
      const input = mistyCollaborationContracts["collaboration.close"].params.parse({ handle });
      return transport.subscribe(`collaboration:${input.handle}`, event => listener(MistyCollaborationEventSchema.parse(event)));
    },
  });
}
export type MistyCollaborationSDK = ReturnType<typeof createCollaborationSDK>;
