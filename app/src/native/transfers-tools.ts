import type {
  ArchiveActionResult,
  ArchiveCreateRequest,
  ArchiveExtractRequest,
  ArchiveListRequest,
  ArchiveListResult,
  CompareFilesRequest,
  CompareFilesResult,
  CompareFoldersRequest,
  CompareFoldersResult,
  DuplicateScanRequest,
  DuplicateScanResult,
  FileSyncApplyRequest,
  FileSyncApplyResult,
  FileSyncCompareRequest,
  FileSyncCompareResult,
  FileSyncPair,
  FileToolsActionResult,
  FileToolsChecksumRequest,
  FileToolsChecksumResult,
  FileToolsChmodRequest,
  FileToolsReadonlyRequest,
  FileToolsSymlinkRequest,
  FileToolsSymlinkTargetRequest,
  FileToolsSymlinkTargetResult,
  OperationQueueSnapshot,
  ProviderRemote,
  SavedSearch,
  SavedSearchesSnapshot,
  TransferFilter,
  TransferPage,
} from "@/native/contracts";
import type { OperationConflictPolicy } from "@/native/contracts/primitives";

import { invoke } from "./invoke";
export function transfersSnapshot(filter: TransferFilter = {}): Promise<TransferPage> {
  return invoke("transfers_snapshot", { filter });
}

export function transfersDeleteSelected(ids: number[]): Promise<void> {
  return invoke("transfers_delete_selected", { ids });
}

export function transfersDeleteAll(): Promise<void> {
  return invoke("transfers_delete_all");
}

export function operationQueueSnapshot(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_snapshot");
}

export function operationQueueCancel(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_cancel", { operationId });
}

export function operationQueueCancelBatch(batchId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_cancel_batch", { batchId });
}

export function operationQueueRetry(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_retry", { operationId });
}

export function operationQueueRetryTransfer(transferId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_retry_transfer", { transferId });
}

export function operationQueuePause(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_pause", { operationId });
}

export function operationQueueResume(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resume", { operationId });
}

export function operationQueuePauseBatch(batchId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_pause_batch", { batchId });
}

export function operationQueueResumeBatch(batchId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resume_batch", { batchId });
}

export function operationQueuePauseAll(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_pause_all");
}

export function operationQueueResumeAll(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resume_all");
}

export function operationQueueSetBandwidthLimit(limit: string): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_set_bandwidth_limit", { limit });
}

export function operationQueueSetTransferProfile(
  profileId: string,
  profileName: string,
  maxConcurrent: number,
  bandwidthLimit: string,
): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_set_transfer_profile", {
    profileId,
    profileName,
    maxConcurrent,
    bandwidthLimit,
  });
}

export function operationQueueUndo(undoTokenId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_undo", { undoTokenId });
}

export function operationQueueRedo(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_redo");
}

export function archiveList(request: ArchiveListRequest): Promise<ArchiveListResult> {
  return invoke("archive_list", { request });
}

export function archiveCreate(request: ArchiveCreateRequest): Promise<ArchiveActionResult> {
  return invoke("archive_create", { request });
}

export function archiveExtract(request: ArchiveExtractRequest): Promise<ArchiveActionResult> {
  return invoke("archive_extract", { request });
}

export function duplicatesScan(request: DuplicateScanRequest): Promise<DuplicateScanResult> {
  return invoke("duplicates_scan", { request });
}

export function duplicatesCancel(scanId: string): Promise<boolean> {
  return invoke("duplicates_cancel", { scanId });
}

export function duplicatesHashRemoteCandidates(scanId: string): Promise<DuplicateScanResult> {
  return invoke("duplicates_hash_remote_candidates", { scanId });
}

export function savedSearchesSnapshot(): Promise<SavedSearchesSnapshot> {
  return invoke("saved_searches_snapshot");
}

export function savedSearchesSave(search: SavedSearch): Promise<SavedSearchesSnapshot> {
  return invoke("saved_searches_save", { search });
}

export function savedSearchesDelete(id: string): Promise<SavedSearchesSnapshot> {
  return invoke("saved_searches_delete", { id });
}

export function compareFiles(request: CompareFilesRequest): Promise<CompareFilesResult> {
  return invoke("compare_files", { request });
}

export function compareFolders(request: CompareFoldersRequest): Promise<CompareFoldersResult> {
  return invoke("compare_folders", { request });
}

export function compareApplyTextMerge(
  mergedText: string,
  targetPath: string,
): Promise<FileToolsActionResult> {
  return invoke("compare_apply_text_merge", { mergedText, targetPath });
}

export function fileToolsChecksum(
  request: FileToolsChecksumRequest,
): Promise<FileToolsChecksumResult> {
  return invoke("file_tools_checksum", { request });
}

export function fileToolsSetReadonly(
  request: FileToolsReadonlyRequest,
): Promise<FileToolsActionResult> {
  return invoke("file_tools_set_readonly", { request });
}

export function fileToolsChmod(request: FileToolsChmodRequest): Promise<FileToolsActionResult> {
  return invoke("file_tools_chmod", { request });
}

export function fileToolsCreateSymlink(
  request: FileToolsSymlinkRequest,
): Promise<FileToolsActionResult> {
  return invoke("file_tools_create_symlink", { request });
}

export function fileToolsReadSymlink(
  request: FileToolsSymlinkTargetRequest,
): Promise<FileToolsSymlinkTargetResult> {
  return invoke("file_tools_read_symlink", { request });
}

export function operationQueueResolveConflict(
  operationId: number,
  policy: OperationConflictPolicy,
  applyToBatch: boolean,
): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resolve_conflict", { operationId, policy, applyToBatch });
}

export function operationQueueClearTerminal(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_clear_terminal");
}

export function fileSyncPairsSnapshot(): Promise<FileSyncPair[]> {
  return invoke("file_sync_pairs_snapshot");
}

export function fileSyncPairSave(pair: FileSyncPair): Promise<FileSyncPair> {
  return invoke("file_sync_pair_save", { pair });
}

export function fileSyncPairRemove(pairId: number): Promise<void> {
  return invoke("file_sync_pair_remove", { pairId });
}

export function fileSyncCompare(request: FileSyncCompareRequest): Promise<FileSyncCompareResult> {
  return invoke("file_sync_compare", { request });
}

export function fileSyncApply(request: FileSyncApplyRequest): Promise<FileSyncApplyResult> {
  return invoke("file_sync_apply", { request });
}

export function remoteDisplayName(remote: ProviderRemote): string {
  return remote.name || "(unnamed remote)";
}
