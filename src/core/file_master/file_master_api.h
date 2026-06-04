#pragma once

#include <functional>

#include "core/net/http_client.h"
#include "file_master.h"

namespace misty::core {

struct RemoteJobStatus {
    std::string job_id;
    std::string operation;
    std::string state;
    std::string phase;
    int64_t bytes_completed = 0;
    int64_t bytes_total = 0;
    std::string source_remote;
    std::string source_path;
    std::string dest_remote;
    std::string dest_path;
    std::string message;
    bool result_ready = false;
    std::string result_kind;
};

using RemoteJobProgressCallback = std::function<bool(const RemoteJobStatus&)>;

HttpResponse list_remote_call(const FileMasterProps& props,
                              RemoteJobProgressCallback progress_callback = nullptr);
HttpResponse remove_remote_call(const FileMasterProps& props,
                                RemoteJobProgressCallback progress_callback = nullptr);
HttpResponse rename_remote_call(const FileMasterProps& props,
                                RemoteJobProgressCallback progress_callback = nullptr);
HttpResponse copy_remote_call(const FileMasterProps& props,
                              RemoteJobProgressCallback progress_callback = nullptr);
HttpResponse move_remote_call(const FileMasterProps& props,
                              RemoteJobProgressCallback progress_callback = nullptr);
DownloadResult download_remote_call(const FileMasterProps& props,
                                    const std::string& local_path,
                                    RemoteJobProgressCallback progress_callback = nullptr);
HttpResponse upload_remote_call(const FileMasterProps& props,
                                const std::string& local_path,
                                const std::string& remote_dir,
                                const std::string& file_name,
                                RemoteJobProgressCallback progress_callback = nullptr);
HttpResponse mkdir_remote_call(const std::string& remote_name,
                               const std::string& remote_path,
                               RemoteJobProgressCallback progress_callback = nullptr);

} // namespace misty::core
