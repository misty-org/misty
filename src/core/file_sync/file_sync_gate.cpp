#include "core/file_sync/file_sync_gate.h"

namespace misty::core {
namespace {
bool is_remote_change(FileSyncChange change) {
    switch (change) {
        case FileSyncChange::RemoteFile:
        case FileSyncChange::RemoteFolder:
        case FileSyncChange::RemoteDelete:
        case FileSyncChange::RemoteRename:
            return true;
        default:
            return false;
    }
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

FileSyncResult RemoteFirstPolicy::result(const FileSyncContext& context) const {
    if (context.event.change == FileSyncChange::Noop) {
        return noop();
    }
    if (is_remote_change(context.event.change) && has_remote(context) && !has_local(context) && !context.sync_entry) {
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
    if (remote && !local && !has_local(context) && !context.sync_entry) {
        return noop();
    }
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
    if (is_remote_change(event.change)) {
        FileSyncRemoteEntry remote;
        remote.entry_id = id;
        remote.remote_name = event.remote_name;
        remote.remote_path = event.pending_event.new_path;
        remote.provider_file_id = event.data.provider_file_id;
        remote.exists = event.change != FileSyncChange::RemoteDelete &&
                        event.change != FileSyncChange::Noop;
        remote.is_dir = event.data.is_dir;
        remote.size = event.data.size;
        remote.created = event.data.created;
        remote.last_modified = event.data.mtime;
        remote.checksum = event.data.content_hash;
        entries_.remote(remote);
    } else {
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
    }

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
