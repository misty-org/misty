#include "core/file_sync/file_sync_gate.h"

#include <algorithm>
#include <array>
#include <iomanip>
#include <random>
#include <sstream>
#include <utility>

namespace misty::core {
namespace {

std::string remote_key(const std::string& remote_name, const std::string& path) {
    return remote_name + ":" + path;
}

FileSyncEntryId uuid() {
    static thread_local std::mt19937_64 gen(std::random_device{}());
    std::array<unsigned char, 16> bytes{};
    for (std::size_t i = 0; i < bytes.size(); i += 8) {
        uint64_t chunk = gen();
        for (std::size_t j = 0; j < 8; ++j) {
            bytes[i + j] = static_cast<unsigned char>((chunk >> (j * 8)) & 0xff);
        }
    }

    bytes[6] = static_cast<unsigned char>((bytes[6] & 0x0f) | 0x40);
    bytes[8] = static_cast<unsigned char>((bytes[8] & 0x3f) | 0x80);

    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (std::size_t i = 0; i < bytes.size(); ++i) {
        if (i == 4 || i == 6 || i == 8 || i == 10) {
            out << '-';
        }
        out << std::setw(2) << static_cast<int>(bytes[i]);
    }
    return out.str();
}

bool has_local(const FileSyncContext& context) {
    return context.local_entry && context.local_entry->exists;
}

bool has_remote(const FileSyncContext& context) {
    return context.remote_entry && context.remote_entry->exists;
}

bool same_value(const std::string& current, const std::string& last) {
    return !current.empty() && !last.empty() && current == last;
}

bool local_changed(const FileSyncContext& context) {
    if (!context.local_entry || !context.local_entry->exists) {
        return false;
    }
    if (!context.sync_entry) {
        return true;
    }
    const auto& local = *context.local_entry;
    const auto& sync = *context.sync_entry;
    if (!local.checksum.empty() || !sync.last_local_checksum.empty()) {
        return !same_value(local.checksum, sync.last_local_checksum);
    }
    if (!local.mtime.empty() || !sync.last_local_mtime.empty()) {
        return local.mtime != sync.last_local_mtime;
    }
    return local.local_path != sync.last_local_path;
}

bool remote_changed(const FileSyncContext& context) {
    if (!context.remote_entry || !context.remote_entry->exists) {
        return false;
    }
    if (!context.sync_entry) {
        return true;
    }
    const auto& remote = *context.remote_entry;
    const auto& sync = *context.sync_entry;
    if (!remote.checksum.empty() || !sync.last_remote_checksum.empty()) {
        return !same_value(remote.checksum, sync.last_remote_checksum);
    }
    if (!remote.last_modified.empty() || !sync.last_remote_mtime.empty()) {
        return remote.last_modified != sync.last_remote_mtime;
    }
    return remote.remote_path != sync.last_remote_path;
}

FileSyncAction local_action(const FileSyncFinalEvent& event) {
    switch (event.change) {
        case FileSyncChange::LocalFile:
        case FileSyncChange::LocalFolder:
            return FileSyncAction::UploadLocal;
        case FileSyncChange::LocalDelete:
            return FileSyncAction::DeleteRemote;
        case FileSyncChange::LocalRename:
            return FileSyncAction::RenameRemote;
        case FileSyncChange::RemoteFile:
        case FileSyncChange::RemoteFolder:
            return FileSyncAction::DownloadRemote;
        case FileSyncChange::RemoteDelete:
            return FileSyncAction::DeleteLocal;
        case FileSyncChange::RemoteRename:
            return FileSyncAction::RenameLocal;
        case FileSyncChange::Noop:
            return FileSyncAction::Noop;
    }
    return FileSyncAction::Noop;
}

FileSyncResult noop() {
    return {};
}

FileSyncResult make_result(FileSyncAction action, FileSyncConflict conflict = FileSyncConflict::None) {
    FileSyncResult out;
    out.action = action;
    out.conflict = conflict;
    return out;
}

} // namespace

FileSyncEntryId FileSyncEntryStore::entry(const FileSyncFinalEvent& event) {
    if (!event.pending_event.old_path.empty()) {
        if (auto id = local_id(event.pending_event.old_path)) {
            local_paths_.erase(event.pending_event.old_path);
            return *id;
        }
    }
    if (!event.pending_event.new_path.empty()) {
        if (auto id = local_id(event.pending_event.new_path)) {
            return *id;
        }
    }
    return uuid();
}

void FileSyncEntryStore::local(const FileSyncLocalEntry& entry) {
    auto old = local_entries_.find(entry.entry_id);
    if (old != local_entries_.end() && !old->second.local_path.empty()) {
        local_paths_.erase(old->second.local_path);
    }
    local_entries_[entry.entry_id] = entry;
    if (!entry.local_path.empty()) {
        local_paths_[entry.local_path] = entry.entry_id;
    }
}

void FileSyncEntryStore::remote(const FileSyncRemoteEntry& entry) {
    auto old = remote_entries_.find(entry.entry_id);
    if (old != remote_entries_.end()) {
        if (!old->second.remote_path.empty()) {
            remote_paths_.erase(remote_key(old->second.remote_name, old->second.remote_path));
        }
        if (!old->second.provider_file_id.empty()) {
            provider_ids_.erase(old->second.provider_file_id);
        }
    }
    remote_entries_[entry.entry_id] = entry;
    if (!entry.remote_path.empty()) {
        remote_paths_[remote_key(entry.remote_name, entry.remote_path)] = entry.entry_id;
    }
    if (!entry.provider_file_id.empty()) {
        provider_ids_[entry.provider_file_id] = entry.entry_id;
    }
}

void FileSyncEntryStore::sync(const FileSyncEntry& entry) {
    sync_entries_[entry.entry_id] = entry;
}

void FileSyncEntryStore::record(const FileSyncFinalEvent& event) {
    const FileSyncEntryId id = entry(event);
    auto local_entry = local(id).value_or(FileSyncLocalEntry{});
    local_entry.entry_id = id;
    local_entry.local_path = event.pending_event.new_path;
    local_entry.exists = event.result.action != FileSyncAction::DeleteLocal &&
                         event.change != FileSyncChange::LocalDelete;
    local_entry.is_dir = event.data.is_dir;
    local_entry.size = event.data.size;
    local_entry.mtime = event.data.mtime;
    local_entry.checksum = event.data.content_hash;
    local(local_entry);

    FileSyncEntry sync_entry = sync(id).value_or(FileSyncEntry{});
    sync_entry.entry_id = id;
    sync_entry.last_local_path = local_entry.local_path;
    sync_entry.last_local_mtime = local_entry.mtime;
    sync_entry.last_local_checksum = local_entry.checksum;

    if (auto remote_entry = remote(id)) {
        sync_entry.last_remote_path = remote_entry->remote_path;
        sync_entry.last_remote_mtime = remote_entry->last_modified;
        sync_entry.last_remote_checksum = remote_entry->checksum;
    } else {
        sync_entry.last_remote_path = event.pending_event.new_path;
        sync_entry.last_remote_mtime = event.data.mtime;
        sync_entry.last_remote_checksum = event.data.content_hash;
    }

    if (event.result.action == FileSyncAction::Conflict) {
        sync_entry.state = FileSyncEntryState::CONFLICT;
    } else if (local_entry.exists && remote(id).has_value()) {
        sync_entry.state = FileSyncEntryState::SYNC;
    } else if (local_entry.exists) {
        sync_entry.state = FileSyncEntryState::LOC;
    } else {
        sync_entry.state = FileSyncEntryState::REM;
    }
    sync(sync_entry);
}

void FileSyncEntryStore::reset() {
    local_entries_.clear();
    remote_entries_.clear();
    sync_entries_.clear();
    local_paths_.clear();
    remote_paths_.clear();
    provider_ids_.clear();
}

std::optional<FileSyncLocalEntry> FileSyncEntryStore::local(FileSyncEntryId entry_id) const {
    const auto it = local_entries_.find(entry_id);
    if (it == local_entries_.end()) {
        return std::nullopt;
    }
    return it->second;
}

std::optional<FileSyncRemoteEntry> FileSyncEntryStore::remote(FileSyncEntryId entry_id) const {
    const auto it = remote_entries_.find(entry_id);
    if (it == remote_entries_.end()) {
        return std::nullopt;
    }
    return it->second;
}

std::optional<FileSyncEntry> FileSyncEntryStore::sync(FileSyncEntryId entry_id) const {
    const auto it = sync_entries_.find(entry_id);
    if (it == sync_entries_.end()) {
        return std::nullopt;
    }
    return it->second;
}

std::optional<FileSyncEntryId> FileSyncEntryStore::local_id(const std::string& path) const {
    const auto it = local_paths_.find(path);
    if (it == local_paths_.end()) {
        return std::nullopt;
    }
    return it->second;
}

std::optional<FileSyncEntryId> FileSyncEntryStore::remote_id(const std::string& remote_name,
                                                             const std::string& path) const {
    const auto it = remote_paths_.find(remote_key(remote_name, path));
    if (it == remote_paths_.end()) {
        return std::nullopt;
    }
    return it->second;
}

std::optional<FileSyncEntryId> FileSyncEntryStore::provider_id(const std::string& provider_file_id) const {
    const auto it = provider_ids_.find(provider_file_id);
    if (it == provider_ids_.end()) {
        return std::nullopt;
    }
    return it->second;
}

FileSyncResult RemoteFirstPolicy::result(const FileSyncContext& context) const {
    if (context.event.change == FileSyncChange::Noop) {
        return noop();
    }
    if (has_remote(context)) {
        return local_changed(context)
            ? make_result(FileSyncAction::DownloadRemote, FileSyncConflict::LocalTmp)
            : make_result(FileSyncAction::DownloadRemote);
    }
    if (context.sync_entry && has_local(context)) {
        return make_result(FileSyncAction::UploadLocal);
    }
    return noop();
}

FileSyncResult LocalFirstPolicy::result(const FileSyncContext& context) const {
    if (context.event.change == FileSyncChange::Noop) {
        return noop();
    }
    if (!has_local(context)) {
        return context.sync_entry ? make_result(FileSyncAction::DeleteRemote) : noop();
    }
    const FileSyncConflict conflict = remote_changed(context)
        ? FileSyncConflict::RemoteTmp
        : FileSyncConflict::None;
    return make_result(local_action(context.event), conflict);
}

FileSyncResult BiDirectionalPolicy::result(const FileSyncContext& context) const {
    if (context.event.change == FileSyncChange::Noop) {
        return noop();
    }

    const bool local = local_changed(context);
    const bool remote = remote_changed(context);
    if (local && remote) {
        return make_result(FileSyncAction::Conflict);
    }
    if (local) {
        return make_result(local_action(context.event));
    }
    if (remote) {
        return make_result(FileSyncAction::DownloadRemote);
    }
    return noop();
}

FileSyncGate::FileSyncGate(FileSyncPolicy mode)
    : mode_(mode),
      policy_(policy(mode)) {}

FileSyncGate::~FileSyncGate() = default;

FileSyncResult FileSyncGate::result(const FileSyncFinalEvent& event) {
    std::lock_guard<std::mutex> lock(mu_);
    FileSyncContext ctx = context(event);
    return policy_->result(ctx);
}

void FileSyncGate::record(const FileSyncFinalEvent& event) {
    if (!event.result.update_entry) {
        return;
    }
    std::lock_guard<std::mutex> lock(mu_);
    entries_.record(event);
}

void FileSyncGate::reset() {
    std::lock_guard<std::mutex> lock(mu_);
    entries_.reset();
}

FileSyncContext FileSyncGate::context(const FileSyncFinalEvent& event) {
    const FileSyncEntryId id = entries_.entry(event);
    FileSyncLocalEntry local;
    local.entry_id = id;
    local.local_path = event.pending_event.new_path;
    local.exists = event.change != FileSyncChange::LocalDelete &&
                   event.change != FileSyncChange::Noop;
    local.is_dir = event.data.is_dir;
    local.size = event.data.size;
    local.mtime = event.data.mtime;
    local.checksum = event.data.content_hash;
    entries_.local(local);

    return FileSyncContext{
        event,
        entries_.local(id),
        entries_.remote(id),
        entries_.sync(id),
    };
}

std::unique_ptr<IFileSyncPolicy> FileSyncGate::policy(FileSyncPolicy mode) {
    switch (mode) {
        case FileSyncPolicy::RemoteFirst:
            return std::make_unique<RemoteFirstPolicy>();
        case FileSyncPolicy::LocalFirst:
            return std::make_unique<LocalFirstPolicy>();
        case FileSyncPolicy::BiDirectional:
            return std::make_unique<BiDirectionalPolicy>();
    }
    return std::make_unique<BiDirectionalPolicy>();
}

} // namespace misty::core
