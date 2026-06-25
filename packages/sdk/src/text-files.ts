import { mistyTextFileContracts } from "@misty/contracts";
import type { MistyCall } from "./transport.js";

export interface MistyTextFileSDK {
  /** Read up to 5 MiB of UTF-8 text from an App-owned file handle. */
  readText(handle: string): Promise<string>;
  /** Replace a writable file's contents. Oversized text is rejected before writing. */
  writeText(handle: string, text: string): Promise<void>;
}
export function createTextFileSDK(call: MistyCall): MistyTextFileSDK {
  return Object.freeze({

    async readText(handle: string) {
      const contract = mistyTextFileContracts["files.readText"];
      return contract.result.parse(
        await call("files.readText", contract.params.parse({ handle })),
      ).text;
    },
    async writeText(handle: string, text: string) {
      const contract = mistyTextFileContracts["files.writeText"];
      contract.result.parse(
        await call("files.writeText", contract.params.parse({ handle, text })),
      );
    },
  });
}
