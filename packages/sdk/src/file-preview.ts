import { mistyFilePreviewContracts, type MistyArchiveFormat, type MistyArchivePreview } from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export interface MistyFilePreviewSDK {
  /** Inspect up to 500 archive entries through an owned file grant. Does not extract files. */
  listArchive(handle: string, format: MistyArchiveFormat): Promise<MistyArchivePreview>;
}
export function createFilePreviewSDK(call: MistyCall): MistyFilePreviewSDK {
  return Object.freeze({
    async listArchive(handle: string, format: MistyArchiveFormat) {
      const contract = mistyFilePreviewContracts["files.listArchive"];
      return contract.result.parse(await call("files.listArchive", contract.params.parse({ handle, format })));
    },
  });
}
