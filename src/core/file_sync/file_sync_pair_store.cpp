#include "core/file_sync/file_sync_pair_store.h"

#include <sqlite3.h>

#include "core/db.h"

namespace misty::core {
namespace {

const char* endpoint_kind_label(FileSyncEndpointKind kind) {
    return kind == FileSyncEndpointKind::Remote ? "remote" : "local";
}

FileSyncEndpointKind endpoint_kind_from_text(const std::string& text) {
    return text == "remote" ? FileSyncEndpointKind::Remote : FileSyncEndpointKind::Local;
}

const char* policy_label(FileSyncPolicy policy) {
    switch (policy) {
        case FileSyncPolicy::RemoteFirst: return "remote_first";
        case FileSyncPolicy::LocalFirst: return "local_first";
        case FileSyncPolicy::BiDirectional: return "bidirectional";
    }
    return "bidirectional";
}

FileSyncPolicy policy_from_text(const std::string& text) {
    if (text == "remote_first") {
        return FileSyncPolicy::RemoteFirst;
    }
    if (text == "local_first") {
        return FileSyncPolicy::LocalFirst;
    }
    return FileSyncPolicy::BiDirectional;
}

}  // namespace

FileSyncPairStore& FileSyncPairStore::get() {
    static FileSyncPairStore instance;
    return instance;
}

bool FileSyncPairStore::initialize(std::string* error) {
    return DB::get().open(error);
}

std::vector<FileSyncPair> FileSyncPairStore::load_all(std::string* error) {
    std::vector<FileSyncPair> pairs;
    if (!initialize(error)) {
        return pairs;
    }

    auto guard = DB::get().acquire();
    auto stmt = guard.prepare(
        "SELECT id, name, "
        "left_kind, left_local_path, left_remote_name, left_remote_path, left_provider_type, "
        "right_kind, right_local_path, right_remote_name, right_remote_path, right_provider_type, "
        "watch_mode, stale, preferred_policy, last_compared_at_ms, last_scan_at_ms "
        "FROM sync_pairs ORDER BY id ASC",
        error);
    if (!stmt.valid()) {
        return pairs;
    }

    while (stmt.step() == SQLITE_ROW) {
        FileSyncPair pair;
        pair.id = stmt.column_int64(0);
        pair.name = stmt.column_text(1);
        pair.left.kind = endpoint_kind_from_text(stmt.column_text(2));
        pair.left.local_path = stmt.column_text(3);
        pair.left.remote_name = stmt.column_text(4);
        pair.left.remote_path = stmt.column_text(5);
        pair.left.provider_type = stmt.column_text(6);
        pair.right.kind = endpoint_kind_from_text(stmt.column_text(7));
        pair.right.local_path = stmt.column_text(8);
        pair.right.remote_name = stmt.column_text(9);
        pair.right.remote_path = stmt.column_text(10);
        pair.right.provider_type = stmt.column_text(11);
        pair.watch_mode = stmt.column_bool(12);
        pair.stale = stmt.column_bool(13);
        pair.preferred_policy = policy_from_text(stmt.column_text(14));
        pair.last_compared_at_ms = stmt.column_int64(15);
        pair.last_scan_at_ms = stmt.column_int64(16);
        pairs.push_back(std::move(pair));
    }
    return pairs;
}

bool FileSyncPairStore::save(FileSyncPair& pair, std::string* error) {
    if (!initialize(error)) {
        return false;
    }
    if (pair.id == 0) {
        pair.id = next_pair_id(error);
        if (pair.id == 0) {
            return false;
        }
    }

    auto guard = DB::get().acquire();
    auto stmt = guard.prepare(
        "INSERT OR REPLACE INTO sync_pairs ("
        "id, name, "
        "left_kind, left_local_path, left_remote_name, left_remote_path, left_provider_type, "
        "right_kind, right_local_path, right_remote_name, right_remote_path, right_provider_type, "
        "watch_mode, stale, preferred_policy, last_compared_at_ms, last_scan_at_ms"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        error);
    if (!stmt.valid()) {
        return false;
    }

    return stmt.bind_int64(1, pair.id) &&
           stmt.bind_text(2, pair.name) &&
           stmt.bind_text(3, endpoint_kind_label(pair.left.kind)) &&
           stmt.bind_text(4, pair.left.local_path) &&
           stmt.bind_text(5, pair.left.remote_name) &&
           stmt.bind_text(6, pair.left.remote_path) &&
           stmt.bind_text(7, pair.left.provider_type) &&
           stmt.bind_text(8, endpoint_kind_label(pair.right.kind)) &&
           stmt.bind_text(9, pair.right.local_path) &&
           stmt.bind_text(10, pair.right.remote_name) &&
           stmt.bind_text(11, pair.right.remote_path) &&
           stmt.bind_text(12, pair.right.provider_type) &&
           stmt.bind_bool(13, pair.watch_mode) &&
           stmt.bind_bool(14, pair.stale) &&
           stmt.bind_text(15, policy_label(pair.preferred_policy)) &&
           stmt.bind_int64(16, pair.last_compared_at_ms) &&
           stmt.bind_int64(17, pair.last_scan_at_ms) &&
           stmt.step() == SQLITE_DONE;
}

bool FileSyncPairStore::remove(int64_t pair_id, std::string* error) {
    if (!initialize(error)) {
        return false;
    }

    auto guard = DB::get().acquire();
    auto stmt = guard.prepare("DELETE FROM sync_pairs WHERE id = ?", error);
    if (!stmt.valid()) {
        return false;
    }
    return stmt.bind_int64(1, pair_id) && stmt.step() == SQLITE_DONE;
}

void FileSyncPairStore::reset_for_testing() {}

int64_t FileSyncPairStore::next_pair_id(std::string* error) {
    if (!initialize(error)) {
        return 0;
    }
    auto guard = DB::get().acquire();
    auto stmt = guard.prepare("SELECT COALESCE(MAX(id), 0) + 1 FROM sync_pairs", error);
    if (!stmt.valid()) {
        return 0;
    }
    if (stmt.step() != SQLITE_ROW) {
        return 0;
    }
    return stmt.column_int64(0);
}

}  // namespace misty::core
