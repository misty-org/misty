#pragma once

#include <string>

#include "core/file_master/file_master.h"
#include "core/threading/worker_pool.h"
#include "core/file_transfer/file_transfer.h"
#include "panels/file_explorer/state/clipboard_state.h"
#include "panels/file_explorer/state/file_listings_state.h"

namespace misty::panel {

bool dispatch_file_master_clipboard_operation(core::WorkerPool& worker_pool,
                                              core::FileTransfer& transfers,
                                              const FileItem& item,
                                              const std::string& dest_dir,
                                              ClipboardOp op,
                                              uint64_t job_id,
                                              core::FileMasterCompletion callback);

bool remove_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             uint64_t job_id,
                             core::FileMasterCompletion callback);

bool rename_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             const std::string& new_name,
                             uint64_t job_id,
                             core::FileMasterCompletion callback);

bool download_remote_file_master_item(core::WorkerPool& worker_pool,
                                      core::FileTransfer& transfers,
                                      const FileItem& item,
                                      uint64_t job_id,
                                      core::FileMasterCompletion callback);

void shutdown_file_transfer_worker_pool();

}  // namespace misty::panel
