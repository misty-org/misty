#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include <functional>
#include "core/ui/ui_registry.h"

namespace misty::panel {

    enum class DownloadStatus {
        PENDING,
        DOWNLOADING,
        COMPLETED,
        FAILED
    };

    struct DownloadItem {
        uint64_t id;
        std::string file_name;
        std::string local_path;
        std::string source;  // "OneDrive", etc.
        int64_t file_size = 0;
        int64_t downloaded_bytes = 0;
        DownloadStatus status = DownloadStatus::PENDING;
        std::string error_message;
        std::chrono::steady_clock::time_point started_at;
        std::chrono::steady_clock::time_point completed_at;

        float get_progress() const {
            if (file_size <= 0) return 0.0f;
            return static_cast<float>(downloaded_bytes) / static_cast<float>(file_size);
        }

        bool is_active() const {
            return status == DownloadStatus::PENDING || status == DownloadStatus::DOWNLOADING;
        }
    };

    class DownloadState : public core::UIState {
    public:
        static constexpr size_t MAX_HISTORY = 50;

        uint64_t start_download(const std::string& file_name,
                                 const std::string& local_path,
                                 const std::string& source,
                                 int64_t file_size = 0) {
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

        void update_progress(uint64_t id, int64_t downloaded_bytes) {
            std::lock_guard<std::mutex> lock(mu);
            for (auto& item : downloads_) {
                if (item.id == id) {
                    item.downloaded_bytes = downloaded_bytes;
                    break;
                }
            }
        }

        void complete_download(uint64_t id) {
            std::lock_guard<std::mutex> lock(mu);
            for (auto& item : downloads_) {
                if (item.id == id) {
                    item.status = DownloadStatus::COMPLETED;
                    item.completed_at = std::chrono::steady_clock::now();
                    item.downloaded_bytes = item.file_size;
                    break;
                }
            }
            cleanup_old_history();
        }

        void fail_download(uint64_t id, const std::string& error) {
            std::lock_guard<std::mutex> lock(mu);
            for (auto& item : downloads_) {
                if (item.id == id) {
                    item.status = DownloadStatus::FAILED;
                    item.error_message = error;
                    item.completed_at = std::chrono::steady_clock::now();
                    break;
                }
            }
            cleanup_old_history();
        }

        void remove_download(uint64_t id) {
            std::lock_guard<std::mutex> lock(mu);
            downloads_.erase(
                std::remove_if(downloads_.begin(), downloads_.end(),
                    [id](const DownloadItem& item) { return item.id == id; }),
                downloads_.end()
            );
        }

        void clear_completed() {
            std::lock_guard<std::mutex> lock(mu);
            downloads_.erase(
                std::remove_if(downloads_.begin(), downloads_.end(),
                    [](const DownloadItem& item) {
                        return item.status == DownloadStatus::COMPLETED ||
                               item.status == DownloadStatus::FAILED;
                    }),
                downloads_.end()
            );
        }

        std::vector<DownloadItem> get_all_downloads() {
            std::lock_guard<std::mutex> lock(mu);
            return downloads_;
        }

        std::vector<DownloadItem> get_active_downloads() {
            std::lock_guard<std::mutex> lock(mu);
            std::vector<DownloadItem> active;
            for (const auto& item : downloads_) {
                if (item.is_active()) {
                    active.push_back(item);
                }
            }
            return active;
        }

        size_t active_count() {
            std::lock_guard<std::mutex> lock(mu);
            size_t count = 0;
            for (const auto& item : downloads_) {
                if (item.is_active()) count++;
            }
            return count;
        }

        size_t total_count() {
            std::lock_guard<std::mutex> lock(mu);
            return downloads_.size();
        }

    private:
        void cleanup_old_history() {
            // Keep only MAX_HISTORY completed/failed items
            size_t completed_count = 0;
            for (auto it = downloads_.rbegin(); it != downloads_.rend(); ++it) {
                if (!it->is_active()) {
                    completed_count++;
                }
            }

            if (completed_count > MAX_HISTORY) {
                size_t to_remove = completed_count - MAX_HISTORY;
                for (auto it = downloads_.begin(); it != downloads_.end() && to_remove > 0;) {
                    if (!it->is_active()) {
                        it = downloads_.erase(it);
                        to_remove--;
                    } else {
                        ++it;
                    }
                }
            }
        }

        std::mutex mu;
        std::vector<DownloadItem> downloads_;
        std::atomic<uint64_t> next_id_{1};
    };

}
