#include "download_state.h"

#include "transfer_state_utils.h"

namespace misty::panel {

uint64_t DownloadState::start_download(const std::string& file_name,
                                       const std::string& local_path,
                                       const std::string& source,
                                       int64_t file_size) {
    std::lock_guard<std::mutex> lock(mu);

    uint64_t id = next_id_++;
    DownloadItem item;
    item.id = id;
    item.file_name = file_name;
    item.local_path = local_path;
    item.source = source;
    item.file_size = file_size;
    item.status = DownloadStatus::DOWNLOADING;
    item.started_at = std::chrono::steady_clock::now();

    downloads_.push_back(item);
    return id;
}

void DownloadState::update_progress(uint64_t id, int64_t downloaded_bytes) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::update_item_by_id(downloads_, id, [downloaded_bytes](DownloadItem& item) {
        item.downloaded_bytes = downloaded_bytes;
    });
}

void DownloadState::complete_download(uint64_t id) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::update_item_by_id(downloads_, id, [](DownloadItem& item) {
        item.status = DownloadStatus::COMPLETED;
        item.completed_at = std::chrono::steady_clock::now();
        item.downloaded_bytes = item.file_size;
    });
    cleanup_old_history();
}

void DownloadState::fail_download(uint64_t id, const std::string& error) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::update_item_by_id(downloads_, id, [&error](DownloadItem& item) {
        item.status = DownloadStatus::FAILED;
        item.error_message = error;
        item.completed_at = std::chrono::steady_clock::now();
    });
    cleanup_old_history();
}

void DownloadState::remove_download(uint64_t id) {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::erase_matching(downloads_, [id](const DownloadItem& item) { return item.id == id; });
}

void DownloadState::clear_completed() {
    std::lock_guard<std::mutex> lock(mu);
    transfer_state::clear_inactive_items(downloads_);
}

std::vector<DownloadItem> DownloadState::get_all_downloads() {
    std::lock_guard<std::mutex> lock(mu);
    return downloads_;
}

std::vector<DownloadItem> DownloadState::get_active_downloads() {
    std::lock_guard<std::mutex> lock(mu);
    return transfer_state::get_active_items_copy(downloads_);
}

size_t DownloadState::active_count() {
    std::lock_guard<std::mutex> lock(mu);
    return transfer_state::count_active_items(downloads_);
}

size_t DownloadState::total_count() {
    std::lock_guard<std::mutex> lock(mu);
    return downloads_.size();
}

void DownloadState::cleanup_old_history() {
    transfer_state::cleanup_old_history(downloads_, MAX_HISTORY);
}

} // namespace misty::panel
