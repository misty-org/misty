#include "core/file_transfer/file_transfer.h"

#include <algorithm>

#include "core/file_transfer/file_transfer_store.h"

namespace misty::core {
namespace {

int64_t now_epoch_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

}  // namespace

FileTransfer::~FileTransfer() {
    stop_background_hydration();
}

bool FileTransferRecord::is_alive() const {
    if (!error_message.empty() ||
        status == FileTransferStatus::Failed ||
        status == FileTransferStatus::Completed ||
        status == FileTransferStatus::Canceled ||
        status == FileTransferStatus::Skipped ||
        status == FileTransferStatus::Interrupted) {
        return false;
    }
    return status == FileTransferStatus::Queued ||
           status == FileTransferStatus::Pending ||
           status == FileTransferStatus::InProgress ||
           status == FileTransferStatus::WaitingForResolution;
}

bool FileTransfer::initialize_persistence(std::string* error) {
    auto& store = FileTransferStore::get();
    if (!store.initialize(error)) {
        return false;
    }

    std::string local_error;
    std::string* effective_error = error != nullptr ? error : &local_error;
    effective_error->clear();
    std::vector<FileTransferRecord> rows = store.load_recent(kMaxHistory, effective_error);
    if (!effective_error->empty()) {
        return false;
    }
    const uint64_t next_id = store.next_transfer_id(effective_error);
    if (!effective_error->empty()) {
        return false;
    }
    hydrate_persisted_rows(std::move(rows), next_id);
    return true;
}

bool FileTransfer::initialize_persistence_metadata(std::string* error) {
    auto& store = FileTransferStore::get();
    if (!store.initialize(error)) {
        return false;
    }

    std::string local_error;
    std::string* effective_error = error != nullptr ? error : &local_error;
    effective_error->clear();
    const uint64_t next_id = store.next_transfer_id(effective_error);
    if (!effective_error->empty()) {
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mu_);
        next_id_.store(std::max<uint64_t>(next_id, 1), std::memory_order_relaxed);
        persistence_enabled_ = true;
    }
    return true;
}

bool FileTransfer::start_background_hydration(std::string* error) {
    {
        std::lock_guard<std::mutex> lock(mu_);
        // Reserve a high local ID range immediately so startup never waits on sqlite
        // just to avoid collisions with persisted transfer rows.
        const uint64_t reserved_floor =
            std::max<uint64_t>(static_cast<uint64_t>(std::max<int64_t>(now_epoch_ms(), 1)) * 1000ULL, 1ULL);
        next_id_.store(std::max(next_id_.load(std::memory_order_relaxed), reserved_floor),
                       std::memory_order_relaxed);
        persistence_enabled_ = true;
    }

    std::lock_guard<std::mutex> lock(hydration_mu_);
    if (hydration_started_ || hydration_in_flight_) {
        return true;
    }

    hydration_error_.clear();
    hydration_failed_ = false;
    hydration_ready_ = false;
    hydration_started_ = true;
    hydration_in_flight_ = true;
    hydration_thread_ = std::thread([this]() {
        std::string local_error;
        auto rows = FileTransferStore::get().load_recent(kMaxHistory, &local_error);
        uint64_t next_id = 1;
        if (local_error.empty()) {
            next_id = FileTransferStore::get().next_transfer_id(&local_error);
        }
        std::lock_guard<std::mutex> hydration_lock(hydration_mu_);
        hydration_in_flight_ = false;
        hydration_failed_ = !local_error.empty();
        hydration_error_ = std::move(local_error);
        pending_hydrated_rows_ = std::move(rows);
        pending_hydrated_next_id_ = next_id;
        hydration_ready_ = true;
    });
    if (error != nullptr) {
        error->clear();
    }
    return true;
}

bool FileTransfer::poll_background_hydration(std::string* error) {
    bool ready = false;
    bool failed = false;
    std::string local_error;
    std::vector<FileTransferRecord> rows;
    uint64_t next_id = 1;
    {
        std::lock_guard<std::mutex> lock(hydration_mu_);
        if (!hydration_ready_) {
            return false;
        }
        ready = true;
        failed = hydration_failed_;
        local_error = hydration_error_;
        rows = std::move(pending_hydrated_rows_);
        next_id = pending_hydrated_next_id_;
        hydration_ready_ = false;
    }

    if (hydration_thread_.joinable()) {
        hydration_thread_.join();
    }

    if (!ready) {
        return false;
    }
    if (failed) {
        if (error != nullptr) {
            *error = local_error;
        }
        return true;
    }

    merge_persisted_rows(std::move(rows), next_id);
    if (error != nullptr) {
        error->clear();
    }
    return true;
}

uint64_t FileTransfer::create_transfer(FileTransferRecord snapshot) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        snapshot.id = next_id_.fetch_add(1);
        if (snapshot.queued_at_ms <= 0) {
            snapshot.queued_at_ms = now_epoch_ms();
        }

        const uint64_t id = snapshot.id;
        transfer_order_.push_back(id);
        auto [it, _] = transfers_.emplace(id, std::move(snapshot));
        notify_record = it->second;
        trim_history();
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
    return notify_record.id;
}

uint64_t FileTransfer::add_listener(Listener listener) {
    if (!listener) {
        return 0;
    }
    std::lock_guard<std::mutex> lock(mu_);
    const uint64_t listener_id = next_listener_id_.fetch_add(1);
    listeners_.emplace(listener_id, std::move(listener));
    return listener_id;
}

void FileTransfer::remove_listener(uint64_t listener_id) {
    if (listener_id == 0) {
        return;
    }
    std::lock_guard<std::mutex> lock(mu_);
    listeners_.erase(listener_id);
}

void FileTransfer::set_local_context(uint64_t id, const std::string& local_path) {
    FileTransferRecord notify_record;
    {
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
        notify_record = it->second;
    }
    notify_listeners(notify_record);
}

void FileTransfer::set_remote_context(uint64_t id, const std::string& remote_name, const std::string& remote_path) {
    FileTransferRecord notify_record;
    {
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
        notify_record = it->second;
    }
    notify_listeners(notify_record);
}

void FileTransfer::update_progress(uint64_t id, int64_t transferred_bytes, int64_t total_bytes) {
    FileTransferRecord notify_record;
    bool should_persist = false;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }

        it->second.transferred_bytes = transferred_bytes;
        if (total_bytes >= 0) {
            it->second.total_bytes = total_bytes;
        }
        if (it->second.status == FileTransferStatus::Queued ||
            it->second.status == FileTransferStatus::Pending ||
            it->second.status == FileTransferStatus::WaitingForResolution) {
            it->second.status = FileTransferStatus::InProgress;
        }
        if (it->second.started_at_ms <= 0) {
            it->second.started_at_ms = now_epoch_ms();
        }
        notify_record = it->second;
        should_persist = should_persist_progress_locked(notify_record, now_epoch_ms());
    }
    if (should_persist) {
        persist_record_if_enabled(notify_record);
    }
    notify_listeners(notify_record);
}

void FileTransfer::update_detail(uint64_t id, const std::string& detail_message) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }
        it->second.detail_message = detail_message;
        notify_record = it->second;
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

void FileTransfer::update_action_flags(uint64_t id,
                                       bool cancelable,
                                       bool retryable,
                                       bool undoable,
                                       uint64_t undo_token_id) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }
        it->second.cancelable = cancelable;
        it->second.retryable = retryable;
        it->second.undoable = undoable;
        it->second.undo_token_id = undo_token_id;
        notify_record = it->second;
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

void FileTransfer::update_conflict_policy(uint64_t id, FileTransferConflictPolicy conflict_policy) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }
        it->second.conflict_policy = conflict_policy;
        notify_record = it->second;
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

void FileTransfer::mark_waiting_for_resolution(uint64_t id, const std::string& detail_message) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }
        it->second.status = FileTransferStatus::WaitingForResolution;
        it->second.detail_message = detail_message;
        notify_record = it->second;
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

void FileTransfer::mark_started(uint64_t id) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }
        it->second.status = FileTransferStatus::InProgress;
        if (it->second.started_at_ms <= 0) {
            it->second.started_at_ms = now_epoch_ms();
        }
        it->second.cancelable = false;
        notify_record = it->second;
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

void FileTransfer::cancel_transfer(uint64_t id, const std::string& detail_message) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }

        it->second.status = FileTransferStatus::Canceled;
        it->second.detail_message = detail_message;
        it->second.completed_at_ms = now_epoch_ms();
        it->second.cancelable = false;
        notify_record = it->second;
        trim_history();
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

uint64_t FileTransfer::start_transfer(FileTransferRecord snapshot) {
    if (snapshot.status == FileTransferStatus::Queued) {
        return create_transfer(std::move(snapshot));
    }
    const uint64_t id = create_transfer(std::move(snapshot));
    mark_started(id);
    return id;
}

void FileTransfer::complete_transfer(uint64_t id) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }

        it->second.status = FileTransferStatus::Completed;
        it->second.completed_at_ms = now_epoch_ms();
        it->second.cancelable = false;
        it->second.retryable = false;
        if (it->second.total_bytes > 0 && it->second.transferred_bytes < it->second.total_bytes) {
            it->second.transferred_bytes = it->second.total_bytes;
        }
        notify_record = it->second;
        trim_history();
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

void FileTransfer::fail_transfer(uint64_t id, const std::string& error_message) {
    FileTransferRecord notify_record;
    {
        std::lock_guard<std::mutex> lock(mu_);

        auto it = transfers_.find(id);
        if (it == transfers_.end()) {
            return;
        }

        it->second.status = FileTransferStatus::Failed;
        it->second.error_message = error_message;
        it->second.completed_at_ms = now_epoch_ms();
        it->second.cancelable = false;
        it->second.retryable = true;
        notify_record = it->second;
        trim_history();
    }
    persist_record_if_enabled(notify_record);
    notify_listeners(notify_record);
}

void FileTransfer::clear_completed() {
    bool should_delete_persisted = false;
    {
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
                last_persisted_progress_at_ms_.erase(id);
                transfers_.erase(it);
                return true;
            }),
            transfer_order_.end());
        should_delete_persisted = persistence_enabled_;
    }
    if (should_delete_persisted) {
        FileTransferStore::get().schedule_delete_completed();
    }
}

void FileTransfer::clear_failed() {
    bool should_delete_persisted = false;
    {
        std::lock_guard<std::mutex> lock(mu_);

        transfer_order_.erase(
            std::remove_if(transfer_order_.begin(), transfer_order_.end(), [this](uint64_t id) {
                auto it = transfers_.find(id);
                if (it == transfers_.end()) {
                    return true;
                }
                if (it->second.status != FileTransferStatus::Failed &&
                    it->second.status != FileTransferStatus::Canceled &&
                    it->second.status != FileTransferStatus::Skipped &&
                    it->second.status != FileTransferStatus::Interrupted) {
                    return false;
                }
                last_persisted_progress_at_ms_.erase(id);
                transfers_.erase(it);
                return true;
            }),
            transfer_order_.end());
        should_delete_persisted = persistence_enabled_;
    }
    if (should_delete_persisted) {
        FileTransferStore::get().schedule_delete_failed_like();
    }
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

bool FileTransfer::get_transfer(uint64_t id, FileTransferRecord& out) const {
    std::lock_guard<std::mutex> lock(mu_);
    const auto it = transfers_.find(id);
    if (it == transfers_.end()) {
        return false;
    }
    out = it->second;
    return true;
}

void FileTransfer::notify_listeners(const FileTransferRecord& record) const {
    std::vector<Listener> listeners;
    {
        std::lock_guard<std::mutex> lock(mu_);
        listeners.reserve(listeners_.size());
        for (const auto& [_, listener] : listeners_) {
            listeners.push_back(listener);
        }
    }
    for (const auto& listener : listeners) {
        if (listener) {
            listener(record);
        }
    }
}

bool FileTransfer::should_persist_progress_locked(const FileTransferRecord& record, int64_t now_ms) {
    const auto it = last_persisted_progress_at_ms_.find(record.id);
    if (it == last_persisted_progress_at_ms_.end()) {
        last_persisted_progress_at_ms_[record.id] = now_ms;
        return true;
    }
    if (now_ms - it->second >= 500) {
        it->second = now_ms;
        return true;
    }
    return false;
}

void FileTransfer::persist_record_if_enabled(const FileTransferRecord& record) {
    if (!persistence_enabled_) {
        return;
    }
    FileTransferStore::get().schedule_upsert(record);
}

void FileTransfer::hydrate_persisted_rows(std::vector<FileTransferRecord> rows, uint64_t next_id) {
    std::lock_guard<std::mutex> lock(mu_);
    transfers_.clear();
    transfer_order_.clear();
    last_persisted_progress_at_ms_.clear();

    for (auto& row : rows) {
        transfer_order_.push_back(row.id);
        transfers_[row.id] = std::move(row);
    }

    next_id_.store(std::max<uint64_t>(next_id, 1), std::memory_order_relaxed);
    persistence_enabled_ = true;
}

void FileTransfer::merge_persisted_rows(std::vector<FileTransferRecord> rows, uint64_t next_id) {
    std::lock_guard<std::mutex> lock(mu_);
    for (auto& row : rows) {
        if (transfers_.contains(row.id)) {
            continue;
        }
        transfer_order_.push_back(row.id);
        transfers_[row.id] = std::move(row);
    }

    std::sort(transfer_order_.begin(), transfer_order_.end(), [this](uint64_t lhs_id, uint64_t rhs_id) {
        const auto lhs_it = transfers_.find(lhs_id);
        const auto rhs_it = transfers_.find(rhs_id);
        if (lhs_it == transfers_.end() || rhs_it == transfers_.end()) {
            return lhs_id < rhs_id;
        }
        const auto& lhs = lhs_it->second;
        const auto& rhs = rhs_it->second;
        if (lhs.queued_at_ms != rhs.queued_at_ms) {
            return lhs.queued_at_ms < rhs.queued_at_ms;
        }
        return lhs.id < rhs.id;
    });
    next_id_.store(std::max(next_id_.load(std::memory_order_relaxed), std::max<uint64_t>(next_id, 1)),
                   std::memory_order_relaxed);
    persistence_enabled_ = true;
}

void FileTransfer::stop_background_hydration() {
    std::thread worker;
    {
        std::lock_guard<std::mutex> lock(hydration_mu_);
        worker = std::move(hydration_thread_);
        hydration_in_flight_ = false;
        hydration_ready_ = false;
    }
    if (worker.joinable()) {
        worker.join();
    }
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
        if (!it->second.is_alive()) {
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
            if (it->second.is_alive()) {
                return false;
            }
            transfers_.erase(it);
            last_persisted_progress_at_ms_.erase(id);
            --remove_count;
            return true;
        }),
        transfer_order_.end());
}

}  // namespace misty::core
