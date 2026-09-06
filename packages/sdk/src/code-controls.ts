import { mistyCodeControlsContracts, type MistyCodeControlsMethod, type MistyCodeControlsParams, type MistyCodeControlsResult } from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export function createCodeControlsSDK(call: MistyCall) {
  const request = async <M extends MistyCodeControlsMethod>(method: M, params: MistyCodeControlsParams<M>): Promise<MistyCodeControlsResult<M>> => {
    const contract = mistyCodeControlsContracts[method];
    return contract.result.parse(await call(method, contract.params.parse(params))) as MistyCodeControlsResult<M>;
  };
  return Object.freeze({
    updatePreference: (input: MistyCodeControlsParams<"code.preferences.update">) => request("code.preferences.update", input),
    openModels: () => request("code.models.open", {}),
    toggleTerminal: (placement: MistyCodeControlsParams<"code.terminal.toggle">["placement"] = "down") => request("code.terminal.toggle", { placement }),
    rewrite: (input: MistyCodeControlsParams<"code.rewrite">) => request("code.rewrite", input),
    cancelRewrite: (requestId: string) => request("code.rewrite.cancel", { requestId }),
  });
}
