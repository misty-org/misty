#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include "core/ui/ui_registry.h"

namespace misty::panel {

    enum class UploadProvider {
        UNKNOWN,
        ONEDRIVE,
        GDRIVE,
        DROPBOX,
        ICLOUD
    };

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
        UploadProvider provider = UploadProvider::UNKNOWN;

        std::string od_ms_user_id;
        std::string od_drive_id;
        std::string od_folder_id;

        std::string gd_user_id;
        std::string gd_folder_id;

        std::string dbx_user_id;
        std::string dbx_folder_path;

        float get_progress() const {
            if (file_size <= 0) return 0.0f;
            return static_cast<float>(uploaded_bytes) / static_cast<float>(file_size);
        }

        bool is_active() const {
            return status == UploadStatus::PENDING || status == UploadStatus::UPLOADING;
        }

        bool can_retry() const {
            if (status != UploadStatus::FAILED || local_path.empty()) return false;

            switch (provider) {
                case UploadProvider::ONEDRIVE:
                    return !od_ms_user_id.empty() && !od_drive_id.empty() && !od_folder_id.empty();
                case UploadProvider::GDRIVE:
                    return !gd_user_id.empty() && !gd_folder_id.empty();
                case UploadProvider::DROPBOX:
                    return !dbx_user_id.empty();
                case UploadProvider::ICLOUD:
                case UploadProvider::UNKNOWN:
                default:
                    return false;
            }
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
        void set_onedrive_retry_context(uint64_t id,
                                        const std::string& ms_user_id,
                                        const std::string& drive_id,
                                        const std::string& folder_id);
        void set_gdrive_retry_context(uint64_t id,
                                      const std::string& gd_user_id,
                                      const std::string& folder_id);
        void set_dropbox_retry_context(uint64_t id,
                                       const std::string& dbx_user_id,
                                       const std::string& folder_path);
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
