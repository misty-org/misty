#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include <functional>
#include "core/ui/state_registry.h"

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

    class DownloadState : public core::StateEntry {
    public:
        static constexpr size_t MAX_HISTORY = 50;

        uint64_t start_download(const std::string& file_name,
                                 const std::string& local_path,
                                 const std::string& source,
                                 int64_t file_size = 0);

        void update_progress(uint64_t id, int64_t downloaded_bytes);
        void complete_download(uint64_t id);
        void fail_download(uint64_t id, const std::string& error);
        void remove_download(uint64_t id);
        void clear_completed();
        std::vector<DownloadItem> get_all_downloads();
        std::vector<DownloadItem> get_active_downloads();
        size_t active_count();
        size_t total_count();

    private:
        void cleanup_old_history();

        std::mutex mu;
        std::vector<DownloadItem> downloads_;
        std::atomic<uint64_t> next_id_{1};
    };

}
