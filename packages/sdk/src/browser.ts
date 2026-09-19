import {
  mistyBrowserContracts,
  MistyBrowserEventSchema,
  MistyBrowserHandleSchema,
  type MistyBrowserEvent,
  type MistyBrowserMethod,
  type MistyBrowserParams,
  type MistyBrowserResult,
} from "@misty/contracts";
import {
  MistySDKError,
  type MistyAppTransport,
  type MistyCall,
} from "./transport.js";

export function createBrowserSDK(
  call: MistyCall,
  transport: MistyAppTransport,
) {
  const request = async <M extends MistyBrowserMethod>(
    method: M,
    params: MistyBrowserParams<M>,
  ): Promise<MistyBrowserResult<M>> => {
    const contract = mistyBrowserContracts[method];
    return contract.result.parse(
      await call(method, contract.params.parse(params)),
    ) as MistyBrowserResult<M>;
  };
  return Object.freeze({
    /** Persist configured destinations so personal agents can discover closed integrations. */
    setDestinations:(destinations:MistyBrowserParams<"browser.destinations.set">["destinations"])=>request("browser.destinations.set",{destinations}),
    availability: () => request("browser.availability", {}),
    removeAccount: (provider: MistyBrowserParams<"browser.removeAccount">["provider"]) =>
      request("browser.removeAccount", { provider }),
    create: (options: MistyBrowserParams<"browser.create">) =>
      request("browser.create", options),
    layout: (
      handle: string,
      options: Omit<MistyBrowserParams<"browser.layout">, "handle">,
    ) => request("browser.layout", { handle, ...options }),
    navigate: (handle: string, url: string) =>
      request("browser.navigate", { handle, url }),
    back: (handle: string) => request("browser.back", { handle }),
    forward: (handle: string) => request("browser.forward", { handle }),
    reload: (handle: string) => request("browser.reload", { handle }),
    setZoom: (handle: string, factor: number) => request("browser.setZoom", { handle, factor }),
    close: (handle: string) => request("browser.close", { handle }),
    inspect: (handle: string) => request("browser.inspect", { handle }),
    click: (handle: string, documentId: string, elementRef: string) =>
      request("browser.click", { handle, documentId, elementRef }),
    interact: (handle: string, documentId: string, action: MistyBrowserParams<"browser.interact">["action"]) =>
      request("browser.interact", { handle, documentId, action }),
    type: (handle: string, documentId: string, elementRef: string, text: string) =>
      request("browser.type", { handle, documentId, elementRef, text }),
    request: (handle: string, path: string) => request("browser.request", { handle, path }),
    overlay: (handle: string, reason: string, active: boolean) =>
      request("browser.overlay", { handle, reason, active }),
    subscribe: async (
      handle: string,
      listener: (event: MistyBrowserEvent) => void,
    ) => {
      if (!transport.subscribe)
        throw new MistySDKError(
          "unsupported_transport",
          "Browser events are unavailable in this runtime.",
        );
      return transport.subscribe(
        `browser:${MistyBrowserHandleSchema.parse(handle)}`,
        (event) => listener(MistyBrowserEventSchema.parse(event)),
      );
    },
  });
}
export type MistyBrowserSDK = ReturnType<typeof createBrowserSDK>;
