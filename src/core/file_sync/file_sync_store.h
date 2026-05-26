#pragma once

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/file_sync/file_sync_types.h"

namespace misty::core {

struct FileSyncRemotePathRef {
    std::string remote_name;
    std::string remote_path;
};

/**
 * @brief Entry state boundary for sync metadata, with room for a hot in-memory cache.
 */
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
    std::unordered_map<std::string, FileSyncEntryState> local_states(const std::vector<std::string>& paths) const;
    std::unordered_map<std::string, FileSyncEntryState> remote_states(const std::vector<FileSyncRemotePathRef>& refs) const;

private:
    std::optional<FileSyncLocalEntry> fetch_local(const FileSyncEntryId& entry_id) const;
    std::optional<FileSyncRemoteEntry> fetch_remote(const FileSyncEntryId& entry_id) const;
    std::optional<FileSyncEntry> fetch_sync(const FileSyncEntryId& entry_id) const;
    std::optional<FileSyncEntryId> fetch_id(const std::string& url) const;
    void cache_local_entry(const FileSyncLocalEntry& entry) const;
    void cache_remote_entry(const FileSyncRemoteEntry& entry) const;
    void cache_sync_entry(const FileSyncEntry& entry) const;
    void cache_bundle_from_record(const std::string& body) const;
    bool post_json(const std::string& path, const std::string& body, std::string* response_body = nullptr) const;
    std::string proxy_url(const std::string& path) const;
    static std::string remote_key(const std::string& remote_name, const std::string& path);
    static FileSyncEntryId uuid();

    mutable std::unordered_map<FileSyncEntryId, FileSyncLocalEntry> local_entries_;
    mutable std::unordered_map<FileSyncEntryId, FileSyncRemoteEntry> remote_entries_;
    mutable std::unordered_map<FileSyncEntryId, FileSyncEntry> sync_entries_;
    mutable std::unordered_map<std::string, FileSyncEntryId> local_paths_;
    mutable std::unordered_map<std::string, FileSyncEntryId> remote_paths_;
    mutable std::unordered_map<std::string, FileSyncEntryId> provider_ids_;
    mutable std::mutex mu_;
};

} // namespace misty::core
