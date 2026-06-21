import { AppRpcError, rpcRecord, type AppRpcScope } from "./session";

/** Exact SDK-to-IPC mapping; no package-supplied native command names. */
export const fileSystemCommands = {
  environment: ["app_environment_snapshot", "files.read"],
  disks: ["devices_snapshot", "files.read"],
  pairedDevices: ["connected_devices_snapshot", "connections.read"],
  deviceRoots: ["connected_devices_roots", "connections.read"],
  listDirectory: ["explorer_list_directory", "files.read"],
  metadata: ["file_metadata_snapshot", "files.read"],
  preview: ["explorer_preview_item", "files.read"],
  queueTransfer: ["explorer_queue_paste_items", "files.write"],
  queueCreate: ["explorer_queue_create_item", "files.write"],
  queueRename: ["explorer_queue_rename_item", "files.write"],
  queueDelete: ["explorer_queue_delete_items", "files.write"],
  queue: ["operation_queue_snapshot", "files.read"],
  transfers: ["transfers_snapshot", "files.read"],
  cancel: ["operation_queue_cancel", "files.write"],
  pause: ["operation_queue_pause", "files.write"],
  resume: ["operation_queue_resume", "files.write"],
  retry: ["operation_queue_retry", "files.write"],
  retryTransfer: ["operation_queue_retry_transfer", "files.write"],
  deleteTransferHistory: ["transfers_delete_selected", "files.write"],
} as const;

export function createFileSystemRpc(
  scope: AppRpcScope,
  invoke: (command: string, params?: Record<string, unknown>) => Promise<unknown>,
) {
  return async ({ method, params }: { method: string; params?: unknown }) => {
    const name = method.slice("fileSystem.".length);
    if (
      !method.startsWith("fileSystem.") ||
      !Object.prototype.hasOwnProperty.call(fileSystemCommands, name)
    )
      throw new AppRpcError("unsupported_method", "This file service is not supported by Misty.");
    const [command, capability] = fileSystemCommands[name as keyof typeof fileSystemCommands];
    scope.assert(capability);
    if (capability === "files.write" || capability === "connections.read")
      scope.assert("files.read");
    const value = await invoke(command, rpcRecord(params ?? {}));
    scope.assert(capability);
    return value;
  };
}
