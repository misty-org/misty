#include "core/file_master/file_master_remote.h"

#include <condition_variable>
#include <filesystem>
#include <mutex>
#include <memory>
#include <utility>

#include "core/file_master/file_master_api.h"
#include "core/file_master/file_master_util.h"

namespace misty::core {
namespace {

FileMasterResult validate_remote_source_required(const FileMasterProps& props) {
    if (props.remote_source.remote_name.empty() || props.remote_source.remote_path.empty()) {
        return make_error("remote_source.remote_name and remote_source.remote_path are required");
    }
    return make_success();
}

FileMasterResult validate_remote_dest_required(const FileMasterProps& props) {
    if (props.remote_dest.remote_name.empty() || props.remote_dest.remote_path.empty()) {
        return make_error("remote_dest.remote_name and remote_dest.remote_path are required");
    }
    return make_success();
}

FileMasterResult validate_remote_source_and_dest_required(const FileMasterProps& props) {
    FileMasterResult result = validate_remote_source_required(props);
    if (!result.success) {
        return result;
    }
    return validate_remote_dest_required(props);
}

std::mutex& remote_transfer_mutex() {
    static std::mutex mutex;
    return mutex;
}

std::condition_variable& remote_transfer_cv() {
    static std::condition_variable cv;
    return cv;
}

int& active_remote_transfer_count() {
    static int count = 0;
    return count;
}

constexpr int kMaxConcurrentRemoteTransfers = 2;

class RemoteTransferSlot {
public:
    RemoteTransferSlot() {
        std::unique_lock<std::mutex> lock(remote_transfer_mutex());
        remote_transfer_cv().wait(lock, []() {
            return active_remote_transfer_count() < kMaxConcurrentRemoteTransfers;
        });
        ++active_remote_transfer_count();
    }

    ~RemoteTransferSlot() {
        {
            std::lock_guard<std::mutex> lock(remote_transfer_mutex());
            --active_remote_transfer_count();
        }
        remote_transfer_cv().notify_one();
    }
};

std::string remote_transfer_name(const FileMasterProps& props) {
    if (!props.file_name.empty()) {
        return props.file_name;
    }
    if (!props.remote_source.remote_path.empty()) {
        return std::filesystem::path(props.remote_source.remote_path).filename().string();
    }
    if (!props.remote_dest.remote_path.empty()) {
        return std::filesystem::path(props.remote_dest.remote_path).filename().string();
    }
    if (!props.local_source.path.empty()) {
        return std::filesystem::path(props.local_source.path).filename().string();
    }
    if (!props.local_dest.path.empty()) {
        return std::filesystem::path(props.local_dest.path).filename().string();
    }
    return {};
}

uint64_t start_remote_transfer(FileTransfer* transfers,
                               const FileMasterProps& props,
                               FileTransferType type) {
    if (!transfers) {
        return 0;
    }

    FileTransferRecord record;
    record.transfer_type = type;
    record.item_type = FileTransferItemType::Remote;
    record.file_name = remote_transfer_name(props);
    record.job_id = props.job_id;
    record.local_source_path = props.local_source.path;
    record.local_dest_path = props.local_dest.path;
    record.remote_source_name = props.remote_source.remote_name;
    record.remote_source_path = props.remote_source.remote_path;
    record.remote_dest_name = props.remote_dest.remote_name;
    record.remote_dest_path = props.remote_dest.remote_path;
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

RemoteJobProgressCallback make_progress_callback(FileTransfer* transfers, uint64_t transfer_id) {
    if (!transfers || transfer_id == 0) {
        return nullptr;
    }
    return [transfers, transfer_id](const RemoteJobStatus& status) {
        transfers->update_progress(transfer_id, status.bytes_completed, status.bytes_total);
        if (!status.source_remote.empty() && !status.source_path.empty()) {
            transfers->set_remote_context(transfer_id, status.source_remote, status.source_path);
        }
        if (!status.dest_remote.empty() && !status.dest_path.empty()) {
            transfers->set_remote_context(transfer_id, status.dest_remote, status.dest_path);
        }
        return true;
    };
}

}  // namespace

FileMasterRemote::FileMasterRemote(WorkerPool& worker_pool)
    : worker_pool_(worker_pool) {}

FileMasterRemote::FileMasterRemote(WorkerPool& worker_pool, FileTransfer* transfers)
    : worker_pool_(worker_pool), transfers_(transfers) {}

void FileMasterRemote::rename(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_remote_props(props);
    FileMasterResult validation = validate_remote_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }
    validation = validate_remote_source_and_dest_required(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }
    if (normalized.remote_source.remote_name != normalized.remote_dest.remote_name) {
        if (callback) callback(make_error("remote rename requires source and destination to use the same remote"));
        return;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_remote_transfer(transfers, normalized, FileTransferType::Rename);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            complete_tracked(
                transfers,
                transfer_id,
                completion,
                rename_remote_path(normalized, make_progress_callback(transfers, transfer_id)));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err) {
            complete_tracked(transfers, transfer_id, completion, make_error("remote rename failed: " + err));
        }
    );
}

void FileMasterRemote::remove(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_remote_props(props);
    FileMasterResult validation = validate_remote_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }
    validation = validate_remote_source_required(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_remote_transfer(transfers, normalized, FileTransferType::Delete);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            complete_tracked(
                transfers,
                transfer_id,
                completion,
                remove_remote_path(normalized, make_progress_callback(transfers, transfer_id)));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err) {
            complete_tracked(transfers, transfer_id, completion, make_error("remote remove failed: " + err));
        }
    );
}

void FileMasterRemote::copy(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_remote_props(props);
    FileMasterResult validation = validate_remote_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }
    if (!normalized.remote_source.empty() && !normalized.remote_dest.empty()) {
        validation = validate_remote_source_and_dest_required(normalized);
    } else if (!normalized.remote_source.empty() && !normalized.local_dest.empty()) {
        validation = validate_remote_source_required(normalized);
    } else if (!normalized.local_source.empty() && !normalized.remote_dest.empty()) {
        validation = validate_remote_dest_required(normalized);
    } else {
        validation = make_error("remote copy requires remote_source with remote_dest or local_dest, or local_source with remote_dest");
    }
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    FileTransferType type = FileTransferType::Copy;
    if (!normalized.remote_source.empty() && !normalized.local_dest.empty()) {
        type = FileTransferType::Download;
    } else if (!normalized.local_source.empty() && !normalized.remote_dest.empty()) {
        type = FileTransferType::Upload;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_remote_transfer(transfers, normalized, type);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            RemoteTransferSlot slot;
            complete_tracked(
                transfers,
                transfer_id,
                completion,
                copy_remote_path(normalized, make_progress_callback(transfers, transfer_id)));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err) {
            complete_tracked(transfers, transfer_id, completion, make_error("remote copy failed: " + err));
        }
    );
}

void FileMasterRemote::cut(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_remote_props(props);
    FileMasterResult validation = validate_remote_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }
    if (!normalized.remote_source.empty() && !normalized.remote_dest.empty()) {
        validation = validate_remote_source_and_dest_required(normalized);
    } else if (!normalized.remote_source.empty() && !normalized.local_dest.empty()) {
        validation = validate_remote_source_required(normalized);
    } else if (!normalized.local_source.empty() && !normalized.remote_dest.empty()) {
        validation = validate_remote_dest_required(normalized);
    } else {
        validation = make_error("remote cut requires a remote/local source and destination");
    }
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    FileTransferType type = FileTransferType::Move;
    if (!normalized.remote_source.empty() && !normalized.local_dest.empty()) {
        type = FileTransferType::Download;
    } else if (!normalized.local_source.empty() && !normalized.remote_dest.empty()) {
        type = FileTransferType::Upload;
    }

    FileTransfer* transfers = transfers_;
    const uint64_t transfer_id = start_remote_transfer(transfers, normalized, type);
    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [transfers, normalized, transfer_id, completion]() {
            RemoteTransferSlot slot;
            complete_tracked(
                transfers,
                transfer_id,
                completion,
                cut_remote_path(normalized, make_progress_callback(transfers, transfer_id)));
        },
        []() {},
        [transfers, transfer_id, completion](const std::string& err) {
            complete_tracked(transfers, transfer_id, completion, make_error("remote cut failed: " + err));
        }
    );
}

void FileMasterRemote::list(const FileMasterProps& props, FileMasterCompletion callback) {
    const FileMasterProps normalized = normalize_remote_props(props);
    FileMasterResult validation = validate_remote_props(normalized);
    if (!validation.success) {
        if (callback) callback(std::move(validation));
        return;
    }

    auto completion = std::make_shared<FileMasterCompletion>(std::move(callback));
    worker_pool_.add(
        [normalized, completion]() {
            std::vector<FileMasterListItem> items;
            complete(completion, list_remote_path(normalized, items));
        },
        []() {},
        [completion](const std::string& err) {
            complete(completion, make_error("remote list failed: " + err));
        }
    );
}

}  // namespace misty::core
