#include "panels/file_explorer/operations/file_master_operations.h"

#include <filesystem>
#include <memory>
#include <mutex>
#include <utility>

#include "core/file_master/file_master_local.h"
#include "core/file_master/file_master_remote.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"

namespace misty::panel {
namespace {

std::string sibling_path_for_name(const std::string& path, const std::string& name) {
    return (std::filesystem::path(path).parent_path() / name).generic_string();
}

std::string target_name_for(const FileItem& item, const std::string& override_name) {
    return override_name.empty() ? item.name : override_name;
}

std::string normalized_local_path(const std::filesystem::path& path) {
    std::error_code ec;
    const std::filesystem::path canonical = std::filesystem::weakly_canonical(path, ec);
    if (!ec && !canonical.empty()) {
        return canonical.lexically_normal().generic_string();
    }
    return path.lexically_normal().generic_string();
}

std::string normalized_remote_path(std::string path) {
    while (!path.empty() && path.front() == '/') {
        path.erase(path.begin());
    }
    return std::filesystem::path(path).lexically_normal().generic_string();
}

bool same_local_destination(const FileItem& item, const std::string& dest_dir) {
    if (item.path.empty() || dest_dir.empty()) {
        return false;
    }
    const std::filesystem::path dest_path = std::filesystem::path(dest_dir) / item.name;
    return normalized_local_path(item.path) == normalized_local_path(dest_path);
}

bool path_is_descendant_of(const std::string& candidate, const std::string& ancestor) {
    if (candidate.empty() || ancestor.empty() || candidate == ancestor) {
        return false;
    }

    std::filesystem::path candidate_path(candidate);
    std::filesystem::path ancestor_path(ancestor);
    auto candidate_it = candidate_path.begin();
    auto ancestor_it = ancestor_path.begin();
    for (; ancestor_it != ancestor_path.end(); ++ancestor_it, ++candidate_it) {
        if (candidate_it == candidate_path.end() || *candidate_it != *ancestor_it) {
            return false;
        }
    }
    return candidate_it != candidate_path.end();
}

bool local_destination_is_inside_source(const FileItem& item, const std::string& dest_dir) {
    if (!item.is_dir || item.path.empty() || dest_dir.empty()) {
        return false;
    }
    const std::filesystem::path dest_path = std::filesystem::path(dest_dir) / item.name;
    return path_is_descendant_of(normalized_local_path(dest_path),
                                 normalized_local_path(item.path));
}

bool same_remote_destination(const core::FileMasterProps& props) {
    if (props.remote_source.remote_name.empty() ||
        props.remote_dest.remote_name.empty() ||
        props.remote_source.remote_name != props.remote_dest.remote_name) {
        return false;
    }
    return normalized_remote_path(props.remote_source.remote_path) ==
           normalized_remote_path(props.remote_dest.remote_path);
}

bool remote_destination_is_inside_source(const core::FileMasterProps& props, const FileItem& item) {
    if (!item.is_dir ||
        props.remote_source.remote_name.empty() ||
        props.remote_dest.remote_name.empty() ||
        props.remote_source.remote_name != props.remote_dest.remote_name) {
        return false;
    }
    return path_is_descendant_of(normalized_remote_path(props.remote_dest.remote_path),
                                 normalized_remote_path(props.remote_source.remote_path));
}

std::mutex& file_transfer_worker_pool_mutex() {
    static std::mutex mutex;
    return mutex;
}

std::unique_ptr<core::WorkerPool>& file_transfer_worker_pool_storage() {
    static std::unique_ptr<core::WorkerPool> pool;
    return pool;
}

core::WorkerPool& file_transfer_worker_pool() {
    std::lock_guard<std::mutex> lock(file_transfer_worker_pool_mutex());
    auto& pool = file_transfer_worker_pool_storage();
    if (!pool) {
        pool = std::make_unique<core::WorkerPool>(4);
    }
    return *pool;
}

}  // namespace

bool dispatch_file_master_clipboard_operation(core::WorkerPool& worker_pool,
                                              core::FileTransfer& transfers,
                                              const FileItem& item,
                                              const std::string& dest_dir,
                                              ClipboardOp op,
                                              uint64_t job_id,
                                              core::FileMasterCompletion callback,
                                              uint64_t transfer_id,
                                              const std::string& target_name_override) {
    (void)worker_pool;
    if (dest_dir.empty() || op == ClipboardOp::NONE) {
        return false;
    }

    if (same_local_destination(item, dest_dir)) {
        return false;
    }
    if (local_destination_is_inside_source(item, dest_dir)) {
        return false;
    }

    const bool dest_is_remote = remote_browse_target_for(dest_dir).has_value();
    if (item.type == FileType::LOCAL && !dest_is_remote) {
        std::filesystem::path resolved_dest = std::filesystem::path(dest_dir) / target_name_for(item, target_name_override);
        std::error_code ec;
        if (std::filesystem::equivalent(std::filesystem::path(item.path), resolved_dest, ec) && !ec) {
            return false;
        }

        auto props = local_file_master_props_for(item, resolved_dest.string());
        props.job_id = job_id;
        props.transfer_id = transfer_id;
        if (!target_name_override.empty()) {
            props.file_name = target_name_override;
        }
        core::FileMasterLocal file_master(file_transfer_worker_pool(), &transfers);
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

    FileItem effective_item = item;
    if (!target_name_override.empty()) {
        effective_item.name = target_name_override;
    }
    auto props = remote_file_master_props_for(effective_item, dest_dir);
    props.job_id = job_id;
    props.transfer_id = transfer_id;
    if (same_remote_destination(props)) {
        return false;
    }
    if (remote_destination_is_inside_source(props, item)) {
        return false;
    }
    core::FileMasterRemote file_master(file_transfer_worker_pool(), &transfers);
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

bool remove_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             uint64_t job_id,
                             core::FileMasterCompletion callback,
                             uint64_t transfer_id) {
    (void)worker_pool;
    if (item.type == FileType::LOCAL) {
        core::FileMasterLocal local_master(file_transfer_worker_pool(), &transfers);
        auto props = local_file_master_props_for(item);
        props.job_id = job_id;
        props.transfer_id = transfer_id;
        local_master.remove(props, std::move(callback));
        return true;
    } else if (is_remote_file_master_item(item)) {
        core::FileMasterRemote remote_master(file_transfer_worker_pool(), &transfers);
        auto props = remote_file_master_props_for(item);
        props.job_id = job_id;
        props.transfer_id = transfer_id;
        remote_master.remove(props, std::move(callback));
        return true;
    }
    return false;
}

bool rename_file_master_item(core::WorkerPool& worker_pool,
                             core::FileTransfer& transfers,
                             const FileItem& item,
                             const std::string& new_name,
                             uint64_t job_id,
                             core::FileMasterCompletion callback,
                             uint64_t transfer_id) {
    (void)worker_pool;
    if (item.type == FileType::LOCAL) {
        core::FileMasterLocal file_master(file_transfer_worker_pool(), &transfers);
        auto props = local_file_master_props_for(item, sibling_path_for_name(item.path, new_name));
        props.job_id = job_id;
        props.transfer_id = transfer_id;
        props.source_is_dir = item.is_dir;
        file_master.rename(props, std::move(callback));
        return true;
    } else if (is_remote_file_master_item(item)) {
        core::FileMasterProps props = remote_file_master_props_for(item);
        props.job_id = job_id;
        props.transfer_id = transfer_id;
        props.source_is_dir = item.is_dir;
        props.remote_dest = props.remote_source;
        props.remote_dest.remote_path = sibling_path_for_name(item.sync_remote_path, new_name);
        core::FileMasterRemote file_master(file_transfer_worker_pool(), &transfers);
        file_master.rename(props, std::move(callback));
        return true;
    }
    return false;
}

bool download_remote_file_master_item(core::WorkerPool& worker_pool,
                                      core::FileTransfer& transfers,
                                      const FileItem& item,
                                      uint64_t job_id,
                                      core::FileMasterCompletion callback,
                                      uint64_t transfer_id,
                                      const std::string& target_name_override) {
    (void)worker_pool;
    if (!is_remote_file_master_item(item) || item.is_dir) {
        return false;
    }

    core::FileMasterRemote file_master(file_transfer_worker_pool(), &transfers);
    auto props = remote_file_master_props_for(item, std::filesystem::path(item.path).parent_path().string());
    props.job_id = job_id;
    props.transfer_id = transfer_id;
    props.local_dest.path = target_name_override.empty()
        ? item.path
        : (std::filesystem::path(item.path).parent_path() / target_name_override).string();
    props.remote_dest = {};
    file_master.copy(props, std::move(callback));
    return true;
}

void shutdown_file_transfer_worker_pool() {
    std::unique_ptr<core::WorkerPool> pool;
    {
        std::lock_guard<std::mutex> lock(file_transfer_worker_pool_mutex());
        pool = std::move(file_transfer_worker_pool_storage());
    }
    if (pool) {
        pool->shutdown();
    }
}

}  // namespace misty::panel
