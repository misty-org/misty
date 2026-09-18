import { mistyFileTransferContracts, type MistyFileTransferRequest, type MistyFileTransferStatus } from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export { mistyFileTransferContracts, MistyFileTransferResultSchema, MistyFileTransferStatusSchema } from "@misty/contracts";
export type { MistyFileTransferRequest, MistyFileTransferResult, MistyFileTransferStatus } from "@misty/contracts";
export interface MistyFileTransferSDK {
  /** Transfers require readable source and writable destination grants. Move also requires a writable source. */
  transferStart(request: MistyFileTransferRequest): Promise<{ jobId: string }>;
  transferStatus(jobId: string): Promise<MistyFileTransferStatus>;
  transferCancel(jobId: string): Promise<void>;
  transferClose(jobId: string): Promise<void>;
}
export function createFileTransferSDK(call: MistyCall): MistyFileTransferSDK {
  return Object.freeze({
    async transferStart(request: MistyFileTransferRequest) {
      const c = mistyFileTransferContracts["files.transferStart"];
      return c.result.parse(await call("files.transferStart", c.params.parse(request)));
    },
    async transferStatus(jobId: string) {
      const c = mistyFileTransferContracts["files.transferStatus"];
      return c.result.parse(await call("files.transferStatus", c.params.parse({ jobId })));
    },
    async transferCancel(jobId: string) {
      const c = mistyFileTransferContracts["files.transferCancel"];
      return c.result.parse(await call("files.transferCancel", c.params.parse({ jobId })));
    },
    async transferClose(jobId: string) {
      const c = mistyFileTransferContracts["files.transferClose"];
      return c.result.parse(await call("files.transferClose", c.params.parse({ jobId })));
    },
  });
}
