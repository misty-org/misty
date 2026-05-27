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
                                              core::FileMasterCompletion callback);

void remove_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             core::FileMasterCompletion callback);

void rename_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             const std::string& new_name,
                             core::FileMasterCompletion callback);

bool download_remote_file_master_item(core::WorkerPool& worker_pool,
                                      core::FileTransfer& transfers,
                                      const FileItem& item,
                                      core::FileMasterCompletion callback);

}  // namespace misty::panel
