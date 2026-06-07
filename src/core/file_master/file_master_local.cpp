#include "core/file_master/file_master_local.h"
#include "core/file_master/file_master_util.h"
#include "core/file_transfer/file_transfer.h"

#include <filesystem>
#include <memory>
#include <utility>

namespace misty::core {
namespace {

int64_t local_transfer_size(const FileMasterProps& props) {
    std::error_code ec;
    if (props.local_source.path.empty() || std::filesystem::is_directory(props.local_source.path, ec) || ec) {
        return 0;
    }
    const auto size = std::filesystem::file_size(props.local_source.path, ec);
    if (ec) {
        return 0;
    }
    return static_cast<int64_t>(size);
}

std::string local_transfer_name(const FileMasterProps& props) {
    if (!props.file_name.empty()) {
        return props.file_name;
    }
    if (!props.local_source.path.empty()) {
        return std::filesystem::path(props.local_source.path).filename().string();
    }
    if (!props.local_dest.path.empty()) {
        return std::filesystem::path(props.local_dest.path).filename().string();
    }
    return {};
}

uint64_t start_local_transfer(FileTransfer* transfers,
                              const FileMasterProps& props,
                              FileTransferType type) {
    if (!transfers) {
        return 0;
    }

    if (props.transfer_id != 0) {
        transfers->mark_started(props.transfer_id);
        return props.transfer_id;
    }

    FileTransferRecord record;
    record.transfer_type = type;
    record.item_type = FileTransferItemType::Local;
    record.file_name = local_transfer_name(props);
    record.job_id = props.job_id;
    record.local_source_path = props.local_source.path;
    record.local_dest_path = props.local_dest.path;
    record.total_bytes = local_transfer_size(props);
    return transfers->start_transfer(std::move(record));
}

void complete_tracked(FileTransfer* transfers,
                      uint64_t transfer_id,
                      const std::shared_ptr<FileMasterCompletion>& callback,
                      FileMasterResult result) {
    if (transfers && transfer_id != 0) {
        if (result.success) {
            transfers->complete_transfer(transfer_id);
        } else {
            transfers->fail_transfer(transfer_id, result.error_message);
        }
    }
    complete(callback, std::move(result));
}

}  // namespace

FileMasterLocal::FileMasterLocal(WorkerPool& worker_pool)
    : worker_pool_(worker_pool) {}

FileMasterLocal::FileMasterLocal(WorkerPool& worker_pool, FileTransfer* transfers)
    : worker_pool_(worker_pool), transfers_(transfers) {}

void FileMasterLocal::rename(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_local_transfer(transfers, normalized, FileTransferType::Rename);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            complete_tracked(transfers, transfer_id, completion, rename_local_path(normalized));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err_msg) {
            complete_tracked(transfers, transfer_id, completion, make_error("rename failed: " + err_msg));
        });
}

void FileMasterLocal::remove(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_local_transfer(transfers, normalized, FileTransferType::Delete);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            complete_tracked(transfers, transfer_id, completion, remove_local_path(normalized));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err_msg) {
            complete_tracked(transfers, transfer_id, completion, make_error("remove failed: " + err_msg));
        });
}

void FileMasterLocal::copy(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_local_transfer(transfers, normalized, FileTransferType::Copy);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            complete_tracked(transfers, transfer_id, completion, copy_local_path(normalized));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err_msg) {
            complete_tracked(transfers, transfer_id, completion, make_error("copy failed: " + err_msg));
        });
}

void FileMasterLocal::cut(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_local_transfer(transfers, normalized, FileTransferType::Move);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            complete_tracked(transfers, transfer_id, completion, cut_local_path(normalized));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err_msg) {
            complete_tracked(transfers, transfer_id, completion, make_error("cut failed: " + err_msg));
        }
    );
}

void FileMasterLocal::list(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_local_props(props);
    FileMasterResult validation = validate_local_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            std::vector<FileMasterListItem> items;
            complete(completion, list_local_path(normalized, items));
        },
        []() {},
        [completion](const std::string& err_msg) {
            complete(completion, make_error("list failed: " + err_msg));
        }
    );
}

} // namespace misty::core
