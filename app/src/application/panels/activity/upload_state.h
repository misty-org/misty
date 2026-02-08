#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include "core/ui/ui_registry.h"

namespace misty::panel {

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
        std::string destination;  // display string, e.g. "onedrive-john"
        int64_t file_size = 0;
        int64_t uploaded_bytes = 0;
        UploadStatus status = UploadStatus::PENDING;
        std::string error_message;
        std::chrono::steady_clock::time_point started_at;
        std::chrono::steady_clock::time_point completed_at;

        // Unified remote context for retry
        std::string remote_name;   // rclone remote name, e.g. "onedrive-john"
        std::string remote_path;   // path within the remote, e.g. "/Documents"

        float get_progress() const {
            if (file_size <= 0) return 0.0f;
            return static_cast<float>(uploaded_bytes) / static_cast<float>(file_size);
        }

        bool is_active() const {
            return status == UploadStatus::PENDING || status == UploadStatus::UPLOADING;
        }

        bool can_retry() const {
            return status == UploadStatus::FAILED && !local_path.empty() && !remote_name.empty();
        }
    };

    class UploadState : public core::UIState {
    public:
        static constexpr size_t MAX_HISTORY = 50;

        uint64_t start_upload(const std::string& file_name,
                               const std::string& local_path,
                               const std::string& destination,
                               int64_t file_size = 0);

        void update_progress(uint64_t id, int64_t uploaded_bytes);
        void complete_upload(uint64_t id);
        void fail_upload(uint64_t id, const std::string& error);
        void set_retry_context(uint64_t id,
                               const std::string& remote_name,
                               const std::string& remote_path);
        void clear_completed();
        std::vector<UploadItem> get_all_uploads();
        size_t active_count();
        size_t total_count();

    private:
        void cleanup_old_history();

        std::mutex mu;
        std::vector<UploadItem> uploads_;
        std::atomic<uint64_t> next_id_{1};
    };

}
