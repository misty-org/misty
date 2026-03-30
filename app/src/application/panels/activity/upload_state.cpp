#include "upload_state.h"

#include "transfer_state_utils.h"

namespace misty::panel {

uint64_t UploadState::start_upload(const std::string& file_name,
                                   const std::string& local_path,
                                   const std::string& destination,
                                   int64_t file_size) {
    std::lock_guard<std::mutex> lock(mu);

    uint64_t id = next_id_++;
    UploadItem item;
    item.id = id;
    item.file_name = file_name;
    item.local_path = local_path;
    item.destination = destination;
    item.file_size = file_size;
    item.status = UploadStatus::UPLOADING;
    item.started_at = std::chrono::steady_clock::now();

    uploads_.push_back(item);
    return id;
}

void UploadState::update_progress(uint64_t id, int64_t uploaded_bytes) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::update_item_by_id(uploads_, id, [uploaded_bytes](UploadItem& item) {
        item.uploaded_bytes = uploaded_bytes;
    });
}

void UploadState::complete_upload(uint64_t id) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::update_item_by_id(uploads_, id, [](UploadItem& item) {
        item.status = UploadStatus::COMPLETED;
        item.completed_at = std::chrono::steady_clock::now();
        item.uploaded_bytes = item.file_size;
    });
    cleanup_old_history();
}

void UploadState::fail_upload(uint64_t id, const std::string& error) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::update_item_by_id(uploads_, id, [&error](UploadItem& item) {
        item.status = UploadStatus::FAILED;
        item.error_message = error;
        item.completed_at = std::chrono::steady_clock::now();
    });
    cleanup_old_history();
}

void UploadState::set_retry_context(uint64_t id,
                                    const std::string& remote_name,
                                    const std::string& remote_path) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::update_item_by_id(uploads_, id, [&](UploadItem& item) {
        item.remote_name = remote_name;
        item.remote_path = remote_path;
    });
}

void UploadState::clear_completed() {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::clear_inactive_items(uploads_);
}

std::vector<UploadItem> UploadState::get_all_uploads() {
    std::lock_guard<std::mutex> lock(mu);
    return uploads_;
}

size_t UploadState::active_count() {
    std::lock_guard<std::mutex> lock(mu);
    return transfer_state::count_active_items(uploads_);
}

size_t UploadState::total_count() {
    std::lock_guard<std::mutex> lock(mu);
    return uploads_.size();
}

void UploadState::cleanup_old_history() {
    transfer_state::cleanup_old_history(uploads_, MAX_HISTORY);
}

} // namespace misty::panel
