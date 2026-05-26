#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <vector>

#include "core/file_sync/file_sync_watcher.h"

namespace misty::core {

using FileSyncEntryId = std::string;

/**
 * @brief Selects which side is authoritative when local and remote snapshots differ.
 */
enum class FileSyncPolicy {
    RemoteFirst,
    LocalFirst,
    BiDirectional,
};

/**
 * @brief Action chosen by the active policy after evaluating a pending sync change.
 */
enum class FileSyncAction {
    Noop,
    UploadLocal,
    DownloadRemote,
    DeleteLocal,
    DeleteRemote,
    RenameLocal,
    RenameRemote,
    Conflict,
};

/**
 * @brief Temporary preview file to create before applying a policy-dominant overwrite.
 */
enum class FileSyncConflict {
    None,
    LocalTmp,
    RemoteTmp,
};

/**
 * @brief Resolved presence state for a logical file across local and remote snapshots.
 */
enum class FileSyncEntryState {
    LOC,
    REM,
    SYNC,
    CONFLICT,
};

/**
 * @brief File metadata captured from a local or remote snapshot for policy decisions.
 */
struct FileSyncData {
    bool is_dir = false;
    int64_t size = 0;
    std::string mtime;
    std::string content_hash;
    std::string created;
    std::string provider_file_id;
};

/**
 * @brief Raw filesystem events grouped into one candidate sync change.
 */
struct FileSyncPendingEvent {
    std::string key;
    std::string old_path;
    std::string new_path;
    std::vector<FsEvent> events;
};

/**
 * @brief Policy result describing what sync action to take and whether to preserve a preview.
 */
struct FileSyncResult {
    FileSyncAction action = FileSyncAction::Noop;
    FileSyncConflict conflict = FileSyncConflict::None;
    bool update_entry = true;
};

/**
 * @brief Coalesced sync change with captured metadata and its policy result.
 */
struct FileSyncFinalEvent {
    FileSyncPendingEvent pending_event;
    FileSyncChange change = FileSyncChange::Noop;
    FileSyncData data;
    FileSyncResult result;
    std::string remote_name;
};

/**
 * @brief Local-side snapshot row keyed by a stable logical file entry id.
 */
struct FileSyncLocalEntry {
    FileSyncEntryId entry_id;
    std::string local_path;
    bool exists = false;
    bool is_dir = false;
    int64_t size = 0;
    std::string mtime;
    std::string checksum;
    std::string observed_at;
};

/**
 * @brief Remote-side snapshot row keyed by a stable logical file entry id.
 */
struct FileSyncRemoteEntry {
    FileSyncEntryId entry_id;
    std::string remote_name;
    std::string remote_path;
    std::string provider_file_id;
    bool exists = false;
    bool is_dir = false;
    int64_t size = 0;
    std::string created;
    std::string last_modified;
    std::string checksum;
    std::string observed_at;
};

/**
 * @brief Resolved sync table row storing the baseline and conflict previews for one logical file.
 */
struct FileSyncEntry {
    FileSyncEntryId entry_id;
    FileSyncEntryState state = FileSyncEntryState::LOC;
    std::string last_local_path;
    std::string last_local_mtime;
    std::string last_local_checksum;
    std::string last_remote_path;
    std::string last_remote_mtime;
    std::string last_remote_checksum;
    std::string local_tmp_path;
    std::string remote_tmp_path;
};

/**
 * @brief Immutable policy input assembled from local, remote, sync-entry, and pending-change state.
 */
struct FileSyncContext {
    const FileSyncFinalEvent& event;
    std::optional<FileSyncLocalEntry> local_entry;
    std::optional<FileSyncRemoteEntry> remote_entry;
    std::optional<FileSyncEntry> sync_entry;
};

inline void from_json(const nlohmann::json& json, FileSyncLocalEntry& entry) {
    entry.entry_id = json.value("entry_id", std::string{});
    entry.local_path = json.value("local_path", std::string{});
    entry.exists = json.value("exists", false);
    entry.is_dir = json.value("is_dir", false);
    entry.size = json.value("size", int64_t{0});
    entry.mtime = json.value("mtime", std::string{});
    entry.checksum = json.value("checksum", std::string{});
    entry.observed_at = json.value("observed_at", std::string{});
}

inline void from_json(const nlohmann::json& json, FileSyncRemoteEntry& entry) {
    entry.entry_id = json.value("entry_id", std::string{});
    entry.remote_name = json.value("remote_name", std::string{});
    entry.remote_path = json.value("remote_path", std::string{});
    entry.provider_file_id = json.value("provider_file_id", std::string{});
    entry.exists = json.value("exists", false);
    entry.is_dir = json.value("is_dir", false);
    entry.size = json.value("size", int64_t{0});
    entry.created = json.value("created", std::string{});
    entry.last_modified = json.value("last_modified", std::string{});
    entry.checksum = json.value("checksum", std::string{});
    entry.observed_at = json.value("observed_at", std::string{});
}

inline void from_json(const nlohmann::json& json, FileSyncEntry& entry) {
    entry.entry_id = json.value("entry_id", std::string{});
    const std::string state = json.value("state", std::string{"LOC"});
    if (state == "REM") {
        entry.state = FileSyncEntryState::REM;
    } else if (state == "SYNC") {
        entry.state = FileSyncEntryState::SYNC;
    } else if (state == "CONFLICT") {
        entry.state = FileSyncEntryState::CONFLICT;
    } else {
        entry.state = FileSyncEntryState::LOC;
    }
    entry.last_local_path = json.value("last_local_path", std::string{});
    entry.last_local_mtime = json.value("last_local_mtime", std::string{});
    entry.last_local_checksum = json.value("last_local_checksum", std::string{});
    entry.last_remote_path = json.value("last_remote_path", std::string{});
    entry.last_remote_mtime = json.value("last_remote_mtime", std::string{});
    entry.last_remote_checksum = json.value("last_remote_checksum", std::string{});
    entry.local_tmp_path = json.value("local_tmp_path", std::string{});
    entry.remote_tmp_path = json.value("remote_tmp_path", std::string{});
}

} // namespace misty::core
