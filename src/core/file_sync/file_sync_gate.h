#pragma once

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
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

class FileSyncEntryStore final {
public:
    FileSyncEntryId entry(const FileSyncFinalEvent& event);
    void local(const FileSyncLocalEntry& entry);
    void remote(const FileSyncRemoteEntry& entry);
    void sync(const FileSyncEntry& entry);
    void record(const FileSyncFinalEvent& event);
    void reset();

    std::optional<FileSyncLocalEntry> local(FileSyncEntryId entry_id) const;
    std::optional<FileSyncRemoteEntry> remote(FileSyncEntryId entry_id) const;
    std::optional<FileSyncEntry> sync(FileSyncEntryId entry_id) const;
    std::optional<FileSyncEntryId> local_id(const std::string& path) const;
    std::optional<FileSyncEntryId> remote_id(const std::string& remote_name, const std::string& path) const;
    std::optional<FileSyncEntryId> provider_id(const std::string& provider_file_id) const;

private:
    std::unordered_map<FileSyncEntryId, FileSyncLocalEntry> local_entries_;
    std::unordered_map<FileSyncEntryId, FileSyncRemoteEntry> remote_entries_;
    std::unordered_map<FileSyncEntryId, FileSyncEntry> sync_entries_;
    std::unordered_map<std::string, FileSyncEntryId> local_paths_;
    std::unordered_map<std::string, FileSyncEntryId> remote_paths_;
    std::unordered_map<std::string, FileSyncEntryId> provider_ids_;
};

class IFileSyncPolicy {
public:
    virtual ~IFileSyncPolicy() = default;
    virtual FileSyncResult result(const FileSyncContext& context) const = 0;
};

class RemoteFirstPolicy final : public IFileSyncPolicy {
public:
    FileSyncResult result(const FileSyncContext& context) const override;
};

class LocalFirstPolicy final : public IFileSyncPolicy {
public:
    FileSyncResult result(const FileSyncContext& context) const override;
};

class BiDirectionalPolicy final : public IFileSyncPolicy {
public:
    FileSyncResult result(const FileSyncContext& context) const override;
};

class FileSyncGate final {
public:
    explicit FileSyncGate(FileSyncPolicy mode = FileSyncPolicy::BiDirectional);
    ~FileSyncGate();

    FileSyncResult result(const FileSyncFinalEvent& event);
    void record(const FileSyncFinalEvent& event);
    void reset();

    FileSyncPolicy mode() const { return mode_; }
    FileSyncEntryStore& entries() { return entries_; }
    const FileSyncEntryStore& entries() const { return entries_; }

private:
    FileSyncContext context(const FileSyncFinalEvent& event);
    static std::unique_ptr<IFileSyncPolicy> policy(FileSyncPolicy mode);

    FileSyncPolicy mode_;
    std::unique_ptr<IFileSyncPolicy> policy_;
    FileSyncEntryStore entries_;
    mutable std::mutex mu_;
};

} // namespace misty::core
