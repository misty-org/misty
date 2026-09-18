import { mistyFileEditingContracts } from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export interface MistyFileEditingSDK {
  /** Copy staged output into an owned writable file, preserving its identity.
   * Consumes the staged copy on success. An I/O failure may leave partial changes.
   */
  replaceCopy(handle: string, target: string): Promise<void>;
  /** Open an owned file in its native application. Requires files.open; macOS first. */
  openExternal(handle: string): Promise<void>;
}
export function createFileEditingSDK(call: MistyCall): MistyFileEditingSDK {
  return Object.freeze({
    async replaceCopy(handle: string, target: string) {
      const contract = mistyFileEditingContracts["files.replaceCopy"];
      contract.result.parse(await call("files.replaceCopy", contract.params.parse({ handle, target })));
    },
    async openExternal(handle: string) {
      const contract = mistyFileEditingContracts["files.openExternal"];
      contract.result.parse(await call("files.openExternal", contract.params.parse({ handle })));
    },
  });
}
