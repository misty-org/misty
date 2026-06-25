import { mistyAiControlsContracts, MistyAiControlsSnapshotSchema,
  type MistyAiControlsMethod, type MistyAiControlsParams, type MistyAiControlsResult, type MistyAiControlsSnapshot } from "@misty/contracts";
import { MistySDKError, type MistyAppTransport, type MistyCall } from "./transport.js";
export function createAiControlsSDK(call: MistyCall, transport: MistyAppTransport) {
  const request = async <M extends MistyAiControlsMethod>(method: M, params: MistyAiControlsParams<M>): Promise<MistyAiControlsResult<M>> => {
    const contract = mistyAiControlsContracts[method];
    return contract.result.parse(await call(method, contract.params.parse(params))) as MistyAiControlsResult<M>;
  };
  return Object.freeze({
    open: (input: {agentId?:string;prompt?:string;conversationId?:string;selectionHash?:string} = {}) => request("ai.open",input),
    snapshot: () => request("ai.snapshot", {}),
    runAction: (actionId: string, selectionHash?: string) => request("ai.action.run", { actionId, ...(selectionHash ? { selectionHash } : {}) }),
    decideProposal: (proposalId: string, decision: MistyAiControlsParams<"ai.proposal.decide">["decision"]) => request("ai.proposal.decide", { proposalId, decision }),
    subscribe(listener: (snapshot: MistyAiControlsSnapshot) => void) {
      if (!transport.subscribe) throw new MistySDKError("unsupported_transport", "AI controls are unavailable.");
      return transport.subscribe("ai", event => listener(MistyAiControlsSnapshotSchema.parse(event)));
    },
  });
}
export type MistyAiControlsSDK = ReturnType<typeof createAiControlsSDK>;
