import { mistyDocumentContracts, type MistyPreparedDocument, type MistyPrepareDocumentOptions } from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export interface MistyDocumentsSDK {
  /** Process a selected file using this app's signed native service. Requires files.read and a Space session. */
  prepare(options: MistyPrepareDocumentOptions): Promise<MistyPreparedDocument>;
}
export function createDocumentsSDK(call: MistyCall): MistyDocumentsSDK {
  return Object.freeze({
    async prepare(options: MistyPrepareDocumentOptions) {
      const contract = mistyDocumentContracts["documents.prepare"];
      return contract.result.parse(await call("documents.prepare", contract.params.parse(options)));
    },
  });
}
