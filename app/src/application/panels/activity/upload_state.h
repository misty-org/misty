#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include "core/ui_registry.h"

namespace minidfs::panel {

    enum class UploadStatus {
        PENDING,
        UPLOADING,
        COMPLETED,
        FAILED
    };

    struct UploadItem {
        uint64_t id;
        std::string file_name;
        std::string local_path;
        std::string destination;  // "OneDrive/account_name", etc.
        int64_t file_size = 0;
        int64_t uploaded_bytes = 0;
        UploadStatus status = UploadStatus::PENDING;
        std::string error_message;
        std::chrono::steady_clock::time_point started_at;
        std::chrono::steady_clock::time_point completed_at;

        float get_progress() const {
            if (file_size <= 0) return 0.0f;
            return static_cast<float>(uploaded_bytes) / static_cast<float>(file_size);
        }

        bool is_active() const {
            return status == UploadStatus::PENDING || status == UploadStatus::UPLOADING;
        }
    };

    class UploadState : public core::UIState {
    public:
        static constexpr size_t MAX_HISTORY = 50;

        uint64_t start_upload(const std::string& file_name,
                               const std::string& local_path,
                               const std::string& destination,
                               int64_t file_size = 0) {
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

        void update_progress(uint64_t id, int64_t uploaded_bytes) {
            std::lock_guard<std::mutex> lock(mu);
            for (auto& item : uploads_) {
                if (item.id == id) {
                    item.uploaded_bytes = uploaded_bytes;
                    break;
                }
            }
        }

        void complete_upload(uint64_t id) {
            std::lock_guard<std::mutex> lock(mu);
            for (auto& item : uploads_) {
                if (item.id == id) {
                    item.status = UploadStatus::COMPLETED;
                    item.completed_at = std::chrono::steady_clock::now();
                    item.uploaded_bytes = item.file_size;
                    break;
                }
            }
            cleanup_old_history();
        }

        void fail_upload(uint64_t id, const std::string& error) {
            std::lock_guard<std::mutex> lock(mu);
            for (auto& item : uploads_) {
                if (item.id == id) {
                    item.status = UploadStatus::FAILED;
                    item.error_message = error;
                    item.completed_at = std::chrono::steady_clock::now();
                    break;
                }
            }
            cleanup_old_history();
        }

        void clear_completed() {
            std::lock_guard<std::mutex> lock(mu);
            uploads_.erase(
                std::remove_if(uploads_.begin(), uploads_.end(),
                    [](const UploadItem& item) {
                        return item.status == UploadStatus::COMPLETED ||
                               item.status == UploadStatus::FAILED;
                    }),
                uploads_.end()
            );
        }

        std::vector<UploadItem> get_all_uploads() {
            std::lock_guard<std::mutex> lock(mu);
            return uploads_;
        }

        size_t active_count() {
            std::lock_guard<std::mutex> lock(mu);
            size_t count = 0;
            for (const auto& item : uploads_) {
                if (item.is_active()) count++;
            }
            return count;
        }

        size_t total_count() {
            std::lock_guard<std::mutex> lock(mu);
            return uploads_.size();
        }

    private:
        void cleanup_old_history() {
            size_t completed_count = 0;
            for (auto it = uploads_.rbegin(); it != uploads_.rend(); ++it) {
                if (!it->is_active()) {
                    completed_count++;
                }
            }

            if (completed_count > MAX_HISTORY) {
                size_t to_remove = completed_count - MAX_HISTORY;
                for (auto it = uploads_.begin(); it != uploads_.end() && to_remove > 0;) {
                    if (!it->is_active()) {
                        it = uploads_.erase(it);
                        to_remove--;
                    } else {
                        ++it;
                    }
                }
            }
        }

        std::mutex mu;
        std::vector<UploadItem> uploads_;
        std::atomic<uint64_t> next_id_{1};
    };

}
