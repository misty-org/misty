import {
  parseMethodParams,
  parseMethodResult,
  type MistyServerMethod,
  type MistyMethodParams,
  type MistyMethodResult,
} from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export * from "@misty/contracts";

/** The method determines both the input and result; callers cannot invent a response type. */
export interface MistyServerSDK {
  call<M extends MistyServerMethod>(
    method: M,
    ...args: {} extends MistyMethodParams<M>
      ? [params?: MistyMethodParams<M>]
      : [params: MistyMethodParams<M>]
  ): Promise<MistyMethodResult<M>>;
}
export function createServerSDK(call: MistyCall): MistyServerSDK {
  const request = async <M extends MistyServerMethod>(
    method: M,
    params?: MistyMethodParams<M>,
  ): Promise<MistyMethodResult<M>> => {
    const input = parseMethodParams(method, params);
    const result = await call<unknown>(method, input);
    return parseMethodResult(method, result);
  };
  return Object.freeze({ call: request as MistyServerSDK["call"] });
}
