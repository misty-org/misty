#include "panels/file_explorer/operations/file_master_operations.h"

#include <filesystem>
#include <utility>

#include "core/file_master/file_master_local.h"
#include "core/file_master/file_master_remote.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"

namespace misty::panel {
namespace {

std::string sibling_path_for_name(const std::string& path, const std::string& name) {
    return (std::filesystem::path(path).parent_path() / name).generic_string();
}

}  // namespace

bool dispatch_file_master_clipboard_operation(core::WorkerPool& worker_pool,
                                              core::FileTransfer& transfers,
                                              const FileItem& item,
                                              const std::string& dest_dir,
                                              ClipboardOp op,
                                              core::FileMasterCompletion callback) {
    if (dest_dir.empty() || op == ClipboardOp::NONE) {
        return false;
    }

    const bool dest_is_remote = remote_browse_target_for(dest_dir).has_value();
    if (item.type == FileType::LOCAL && !dest_is_remote) {
        std::filesystem::path resolved_dest = std::filesystem::path(dest_dir) / item.name;
        std::error_code ec;
        if (std::filesystem::equivalent(std::filesystem::path(item.path), resolved_dest, ec) && !ec) {
            return false;
        }

        const auto props = local_file_master_props_for(item, resolved_dest.string());
        core::FileMasterLocal file_master(worker_pool, &transfers);
        if (op == ClipboardOp::CUT) {
            file_master.cut(props, std::move(callback));
            return true;
        }
        if (op == ClipboardOp::COPY) {
            file_master.copy(props, std::move(callback));
            return true;
        }
        return false;
    }

    const auto props = remote_file_master_props_for(item, dest_dir);
    core::FileMasterRemote file_master(worker_pool, &transfers);
    if (op == ClipboardOp::CUT) {
        file_master.cut(props, std::move(callback));
        return true;
    }
    if (op == ClipboardOp::COPY) {
        file_master.copy(props, std::move(callback));
        return true;
    }
    return false;
}

void remove_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             core::FileMasterCompletion callback) {
    if (item.type == FileType::LOCAL) {
        core::FileMasterLocal local_master(worker_pool, &transfers);
        local_master.remove(local_file_master_props_for(item), std::move(callback));
    } else if (is_remote_file_master_item(item)) {
        core::FileMasterRemote remote_master(worker_pool, &transfers);
        remote_master.remove(remote_file_master_props_for(item), std::move(callback));
    }
}

void rename_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             const std::string& new_name,
                             core::FileMasterCompletion callback) {
    if (item.type == FileType::LOCAL) {
        core::FileMasterLocal file_master(worker_pool, &transfers);
        file_master.rename(local_file_master_props_for(item, sibling_path_for_name(item.path, new_name)),
                           std::move(callback));
    } else if (is_remote_file_master_item(item)) {
        core::FileMasterProps props = remote_file_master_props_for(item);
        props.remote_dest = props.remote_source;
        props.remote_dest.remote_path = sibling_path_for_name(item.sync_remote_path, new_name);
        core::FileMasterRemote file_master(worker_pool, &transfers);
        file_master.rename(props, std::move(callback));
    }
}

bool download_remote_file_master_item(core::WorkerPool& worker_pool,
                                      core::FileTransfer& transfers,
                                      const FileItem& item,
                                      core::FileMasterCompletion callback) {
    if (!is_remote_file_master_item(item) || item.is_dir) {
        return false;
    }

    core::FileMasterRemote file_master(worker_pool, &transfers);
    auto props = remote_file_master_props_for(item, std::filesystem::path(item.path).parent_path().string());
    props.local_dest.path = item.path;
    props.remote_dest = {};
    file_master.copy(props, std::move(callback));
    return true;
}

}  // namespace misty::panel
