#pragma once

#include <chrono>
#include <memory>
#include <optional>
#include <string>

#include "file_master.h"
#include "file_master_api.h"

namespace misty::core {

/* File Master Utility Functions */
void complete(const std::shared_ptr<FileMasterCompletion>& callback, FileMasterResult result);

FileMasterResult make_success();

FileMasterResult make_error(std::string error_message);

/* Local File Master Utility Functions */
FileMasterLocalContext normalize_local_context(const FileMasterLocalContext& context);

FileMasterProps normalize_local_props(const FileMasterProps& props);

FileMasterResult validate_local_props(const FileMasterProps& props);

FileMasterResult rename_local_path(const FileMasterProps& props);

FileMasterResult remove_local_path(const FileMasterProps& props);

FileMasterResult copy_local_path(const FileMasterProps& props);

FileMasterResult cut_local_path(const FileMasterProps& props);

FileMasterResult list_local_path(const FileMasterProps& props, std::vector<FileMasterListItem>& items);

/* Remote File Master Utility Functions */
FileMasterRemoteContext normalize_remote_context(const FileMasterRemoteContext& context);

FileMasterProps normalize_remote_props(const FileMasterProps& props);

FileMasterResult validate_remote_props(const FileMasterProps& props);

FileMasterResult rename_remote_path(const FileMasterProps& props,
                                    RemoteJobProgressCallback progress_callback = nullptr);

FileMasterResult remove_remote_path(const FileMasterProps& props,
                                    RemoteJobProgressCallback progress_callback = nullptr);

FileMasterResult copy_remote_path(const FileMasterProps& props,
                                  RemoteJobProgressCallback progress_callback = nullptr);

FileMasterResult cut_remote_path(const FileMasterProps& props,
                                 RemoteJobProgressCallback progress_callback = nullptr);

bool load_cached_remote_path(const FileMasterProps& props, std::vector<FileMasterListItem>& items);

std::optional<std::chrono::system_clock::time_point> cached_remote_path_time(const FileMasterProps& props);

FileMasterResult list_remote_path(const FileMasterProps& props,
                                  std::vector<FileMasterListItem>& items,
                                  RemoteJobProgressCallback progress_callback = nullptr);


} // namespace misty::core
