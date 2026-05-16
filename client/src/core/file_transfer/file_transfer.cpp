#include "core/file_transfer/file_transfer.h"

#include <algorithm>

namespace misty::core {

void FileTransfer::set_local_context(uint64_t id, const std::string& local_path) {
    std::lock_guard<std::mutex> lock(mu_);

    auto it = transfers_.find(id);
    if (it == transfers_.end()) {
        return;
    }

    if (it->second.local_source_path.empty()) {
        it->second.local_source_path = local_path;
    } else {
        it->second.local_dest_path = local_path;
    }
}

void FileTransfer::set_remote_context(uint64_t id, const std::string& remote_name, const std::string& remote_path) {
    std::lock_guard<std::mutex> lock(mu_);

    auto it = transfers_.find(id);
    if (it == transfers_.end()) {
        return;
    }

    if (it->second.remote_source_name.empty() && it->second.remote_source_path.empty()) {
        it->second.remote_source_name = remote_name;
        it->second.remote_source_path = remote_path;
    } else {
        it->second.remote_dest_name = remote_name;
        it->second.remote_dest_path = remote_path;
    }
}

void FileTransfer::update_progress(uint64_t id, int64_t transferred_bytes) {
    std::lock_guard<std::mutex> lock(mu_);

    auto it = transfers_.find(id);
    if (it == transfers_.end()) {
        return;
    }

    it->second.transferred_bytes = transferred_bytes;
    if (it->second.status == FileTransferStatus::Pending) {
        it->second.status = FileTransferStatus::InProgress;
    }
}

uint64_t FileTransfer::start_transfer(FileTransferRecord snapshot) {
    std::lock_guard<std::mutex> lock(mu_);

    snapshot.id = next_id_.fetch_add(1);
    if (snapshot.status == FileTransferStatus::Pending) {
        snapshot.status = FileTransferStatus::InProgress;
    }
    if (snapshot.started_at == std::chrono::steady_clock::time_point{}) {
        snapshot.started_at = std::chrono::steady_clock::now();
    }

    const uint64_t id = snapshot.id;
    transfer_order_.push_back(id);
    transfers_.emplace(id, std::move(snapshot));
    trim_history();
    return id;
}

void FileTransfer::complete_transfer(uint64_t id) {
    std::lock_guard<std::mutex> lock(mu_);

    auto it = transfers_.find(id);
    if (it == transfers_.end()) {
        return;
    }

    it->second.status = FileTransferStatus::Completed;
    it->second.completed_at = std::chrono::steady_clock::now();
    if (it->second.total_bytes > 0 && it->second.transferred_bytes < it->second.total_bytes) {
        it->second.transferred_bytes = it->second.total_bytes;
    }
    trim_history();
}

void FileTransfer::fail_transfer(uint64_t id, const std::string& error_message) {
    std::lock_guard<std::mutex> lock(mu_);

    auto it = transfers_.find(id);
    if (it == transfers_.end()) {
        return;
    }

    it->second.status = FileTransferStatus::Failed;
    it->second.error_message = error_message;
    it->second.completed_at = std::chrono::steady_clock::now();
    trim_history();
}

void FileTransfer::clear_completed() {
    std::lock_guard<std::mutex> lock(mu_);

    transfer_order_.erase(
        std::remove_if(transfer_order_.begin(), transfer_order_.end(), [this](uint64_t id) {
            auto it = transfers_.find(id);
            if (it == transfers_.end()) {
                return true;
            }
            if (it->second.status != FileTransferStatus::Completed) {
                return false;
            }
            transfers_.erase(it);
            return true;
        }),
        transfer_order_.end());
}

std::vector<FileTransferRecord> FileTransfer::get_all_transfers() const {
    std::lock_guard<std::mutex> lock(mu_);
    std::vector<FileTransferRecord> result;
    result.reserve(transfer_order_.size());
    for (uint64_t id : transfer_order_) {
        auto it = transfers_.find(id);
        if (it != transfers_.end()) {
            result.push_back(it->second);
        }
    }
    return result;
}

void FileTransfer::trim_history() {
    if (transfers_.size() <= kMaxHistory) {
        return;
    }

    size_t removable_count = 0;
    for (uint64_t id : transfer_order_) {
        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            continue;
        }
        if (!it->second.is_alive() && it->second.status != FileTransferStatus::Failed) {
            ++removable_count;
        }
    }

    size_t remove_count = transfers_.size() - kMaxHistory;
    if (removable_count == 0) {
        return;
    }
    remove_count = std::min(remove_count, removable_count);

    transfer_order_.erase(
        std::remove_if(transfer_order_.begin(), transfer_order_.end(), [this, &remove_count](uint64_t id) mutable {
            if (remove_count == 0) {
                return false;
            }
            auto it = transfers_.find(id);
            if (it == transfers_.end()) {
                return true;
            }
            if (it->second.is_alive() || it->second.status == FileTransferStatus::Failed) {
                return false;
            }
            transfers_.erase(it);
            --remove_count;
            return true;
        }),
        transfer_order_.end());
}

}  // namespace misty::core
