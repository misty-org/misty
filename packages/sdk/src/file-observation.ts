import { mistyFileObservationContracts, type MistyFileMetadata, type MistyDirectoryWatchStatus } from "@misty/contracts";
import type { MistyCall } from "./transport.js";

export interface MistyFileObservationSDK {
  stat(handle: string): Promise<MistyFileMetadata>;
  /** Watches a chosen folder recursively. Revisions invalidate cached directory/file data.
   * Events contain no native paths. Close the watch when the owning view closes.
   */
  watchDirectory(directory: string): Promise<{ watcher: string }>;
  watchStatus(watcher: string): Promise<MistyDirectoryWatchStatus>;
  watchClose(watcher: string): Promise<void>;
}
export function createFileObservationSDK(call: MistyCall): MistyFileObservationSDK {
  return Object.freeze({
    async stat(handle: string) {
      const contract = mistyFileObservationContracts["files.stat"];
      return contract.result.parse(await call("files.stat", contract.params.parse({ handle })));
    },
    async watchDirectory(directory: string) {
      const contract = mistyFileObservationContracts["files.watchDirectory"];
      return contract.result.parse(await call("files.watchDirectory", contract.params.parse({ directory })));
    },
    async watchStatus(watcher: string) {
      const contract = mistyFileObservationContracts["files.watchStatus"];
      return contract.result.parse(await call("files.watchStatus", contract.params.parse({ watcher })));
    },
    async watchClose(watcher: string) {
      const contract = mistyFileObservationContracts["files.watchClose"];
      contract.result.parse(await call("files.watchClose", contract.params.parse({ watcher })));
    },
  });
}
