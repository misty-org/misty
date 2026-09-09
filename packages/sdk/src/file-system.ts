import type { MistyCall, MistyAppTransport } from "./transport.js";
import { MistySDKError } from "./transport.js";
import type * as Native from "./file-system-types.js";
export type * from "./file-system-types.js";

export interface MistyFileWorkspaceOptions { view: "explorer" | "transfers"; active?: boolean }
export interface MistyFileWorkspaceMount {
  update(options: MistyFileWorkspaceOptions): void;
  unmount(): void;
}
/** Existing desktop filesystem services. Access is covered by the App's installation scopes. */
export function createFileSystemSDK(call: MistyCall, transport: MistyAppTransport) {
  return Object.freeze({
    async mountWorkspace(root: HTMLElement, options: MistyFileWorkspaceOptions): Promise<MistyFileWorkspaceMount> {
      if (!transport.mountFileWorkspace) throw new MistySDKError("host_update_required", "Update Misty to use its file workspace.");
      return transport.mountFileWorkspace(root, options);
    },
    environment: () => call<Native.AppEnvironmentSnapshot>("fileSystem.environment"),
    disks: () => call<Native.DeviceSnapshot>("fileSystem.disks"),
    pairedDevices: () => call<Native.ConnectedDevicesSnapshot>("fileSystem.pairedDevices"),
    deviceRoots: (deviceId: string) => call<Native.PeerRoot[]>("fileSystem.deviceRoots", {deviceId}),
    listDirectory: (request: Native.ListDirectoryRequest) => call<Native.DirectoryListing>("fileSystem.listDirectory", {request}),
    metadata: (path: string) => call<Native.FileMetadataSnapshot>("fileSystem.metadata", {path}),
    preview: (path: string) => call<Native.ExplorerPreviewPayload>("fileSystem.preview", {path}),
    queueTransfer: (request: Native.PasteItemsRequest) => call<Native.OperationQueueSnapshot>("fileSystem.queueTransfer", {request}),
    queueCreate: (request: Native.CreateItemRequest) => call<Native.OperationQueueSnapshot>("fileSystem.queueCreate", {request}),
    queueRename: (request: Native.RenameItemRequest) => call<Native.OperationQueueSnapshot>("fileSystem.queueRename", {request}),
    queueDelete: (request: Native.DeleteItemsRequest) => call<Native.OperationQueueSnapshot>("fileSystem.queueDelete", {request}),
    queue: () => call<Native.OperationQueueSnapshot>("fileSystem.queue"),
    transfers: (filter: Native.TransferFilter = {}) => call<Native.TransferPage>("fileSystem.transfers", {filter}),
    cancel: (operationId: number) => call<Native.OperationQueueSnapshot>("fileSystem.cancel", {operationId}),
    pause: (operationId: number) => call<Native.OperationQueueSnapshot>("fileSystem.pause", {operationId}),
    resume: (operationId: number) => call<Native.OperationQueueSnapshot>("fileSystem.resume", {operationId}),
    retry: (operationId: number) => call<Native.OperationQueueSnapshot>("fileSystem.retry", {operationId}),
    retryTransfer: (transferId: number) => call<Native.OperationQueueSnapshot>("fileSystem.retryTransfer", {transferId}),
    deleteTransferHistory: (ids: number[]) => call<void>("fileSystem.deleteTransferHistory", {ids}),
  });
}
export type MistyFileSystemSDK = ReturnType<typeof createFileSystemSDK>;
