#include "core/file_sync/file_sync_store.h"

#include <array>
#include <iomanip>
#include <nlohmann/json.hpp>
#include <random>
#include <sstream>
#include <utility>

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"

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

bool response_ok(const HttpResponse& response) {
    return response.status_code >= 200 && response.status_code < 300;
}

FileSyncEntryState state_from_string(const std::string& state) {
    if (state == "REM") {
        return FileSyncEntryState::REM;
    }
    if (state == "SYNC") {
        return FileSyncEntryState::SYNC;
    }
    if (state == "CONFLICT") {
        return FileSyncEntryState::CONFLICT;
    }
    return FileSyncEntryState::LOC;
}

template <typename Entry>
std::optional<Entry> parse_entry_body(const std::string& body) {
    const auto json = nlohmann::json::parse(body, nullptr, false);
    if (!json.is_object() || json.is_null()) {
        return std::nullopt;
    }
    return json.get<Entry>();
}

} // namespace

std::string FileSyncEntryStore::remote_key(const std::string& remote_name, const std::string& path) {
    return remote_name + ":" + path;
}

FileSyncEntryId FileSyncEntryStore::uuid() {
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

FileSyncEntryId FileSyncEntryStore::entry(const FileSyncFinalEvent& event) {
    if (is_remote_change(event.change)) {
        if (!event.data.provider_file_id.empty()) {
            if (auto id = provider_id(event.data.provider_file_id)) {
                return *id;
            }
        }
        if (!event.remote_name.empty() && !event.pending_event.old_path.empty()) {
            if (auto id = remote_id(event.remote_name, event.pending_event.old_path)) {
                return *id;
            }
        }
        if (!event.remote_name.empty() && !event.pending_event.new_path.empty()) {
            if (auto id = remote_id(event.remote_name, event.pending_event.new_path)) {
                return *id;
            }
        }
        return uuid();
    }

    if (!event.pending_event.old_path.empty()) {
        if (auto id = local_id(event.pending_event.old_path)) {
            std::lock_guard<std::mutex> lock(mu_);
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
    nlohmann::json body{
        {"entry_id", entry.entry_id},
        {"local_path", entry.local_path},
        {"exists", entry.exists},
        {"is_dir", entry.is_dir},
        {"size", entry.size},
        {"mtime", entry.mtime},
        {"checksum", entry.checksum},
        {"observed_at", entry.observed_at},
    };

    std::string response_body;
    if (post_json("/api/file-sync/local", body.dump(), &response_body)) {
        if (auto response = parse_entry_body<FileSyncLocalEntry>(response_body)) {
            cache_local_entry(*response);
            return;
        }
    }
    cache_local_entry(entry);
}

void FileSyncEntryStore::remote(const FileSyncRemoteEntry& entry) {
    nlohmann::json body{
        {"entry_id", entry.entry_id},
        {"remote_name", entry.remote_name},
        {"remote_path", entry.remote_path},
        {"provider_file_id", entry.provider_file_id},
        {"exists", entry.exists},
        {"is_dir", entry.is_dir},
        {"size", entry.size},
        {"created", entry.created},
        {"last_modified", entry.last_modified},
        {"checksum", entry.checksum},
        {"observed_at", entry.observed_at},
    };

    std::string response_body;
    if (post_json("/api/file-sync/remote", body.dump(), &response_body)) {
        if (auto response = parse_entry_body<FileSyncRemoteEntry>(response_body)) {
            cache_remote_entry(*response);
            return;
        }
    }
    cache_remote_entry(entry);
}

void FileSyncEntryStore::sync(const FileSyncEntry& entry) {
    nlohmann::json body{
        {"entry_id", entry.entry_id},
        {"state", static_cast<int>(entry.state) == static_cast<int>(FileSyncEntryState::LOC) ? "LOC" :
                  static_cast<int>(entry.state) == static_cast<int>(FileSyncEntryState::REM) ? "REM" :
                  static_cast<int>(entry.state) == static_cast<int>(FileSyncEntryState::SYNC) ? "SYNC" : "CONFLICT"},
        {"last_local_path", entry.last_local_path},
        {"last_local_mtime", entry.last_local_mtime},
        {"last_local_checksum", entry.last_local_checksum},
        {"last_remote_path", entry.last_remote_path},
        {"last_remote_mtime", entry.last_remote_mtime},
        {"last_remote_checksum", entry.last_remote_checksum},
        {"local_tmp_path", entry.local_tmp_path},
        {"remote_tmp_path", entry.remote_tmp_path},
    };

    std::string response_body;
    if (post_json("/api/file-sync/sync", body.dump(), &response_body)) {
        if (auto response = parse_entry_body<FileSyncEntry>(response_body)) {
            cache_sync_entry(*response);
            return;
        }
    }
    cache_sync_entry(entry);
}

void FileSyncEntryStore::record(const FileSyncFinalEvent& event) {
    nlohmann::json body{
        {"remote_name", event.remote_name},
        {"change", [event] {
            switch (event.change) {
                case FileSyncChange::LocalFile: return "LocalFile";
                case FileSyncChange::LocalFolder: return "LocalFolder";
                case FileSyncChange::LocalDelete: return "LocalDelete";
                case FileSyncChange::LocalRename: return "LocalRename";
                case FileSyncChange::RemoteFile: return "RemoteFile";
                case FileSyncChange::RemoteFolder: return "RemoteFolder";
                case FileSyncChange::RemoteDelete: return "RemoteDelete";
                case FileSyncChange::RemoteRename: return "RemoteRename";
                case FileSyncChange::Noop: return "Noop";
            }
            return "Noop";
        }()},
        {"pending_event", {
            {"key", event.pending_event.key},
            {"old_path", event.pending_event.old_path},
            {"new_path", event.pending_event.new_path},
        }},
        {"data", {
            {"is_dir", event.data.is_dir},
            {"size", event.data.size},
            {"mtime", event.data.mtime},
            {"content_hash", event.data.content_hash},
            {"created", event.data.created},
            {"provider_file_id", event.data.provider_file_id},
        }},
        {"result", {
            {"action", [event] {
                switch (event.result.action) {
                    case FileSyncAction::Noop: return "Noop";
                    case FileSyncAction::UploadLocal: return "UploadLocal";
                    case FileSyncAction::DownloadRemote: return "DownloadRemote";
                    case FileSyncAction::DeleteLocal: return "DeleteLocal";
                    case FileSyncAction::DeleteRemote: return "DeleteRemote";
                    case FileSyncAction::RenameLocal: return "RenameLocal";
                    case FileSyncAction::RenameRemote: return "RenameRemote";
                    case FileSyncAction::Conflict: return "Conflict";
                }
                return "Noop";
            }()},
            {"conflict", event.result.conflict == FileSyncConflict::LocalTmp ? "LocalTmp" :
                         event.result.conflict == FileSyncConflict::RemoteTmp ? "RemoteTmp" : "None"},
            {"update_entry", event.result.update_entry},
        }},
    };

    std::string response_body;
    if (post_json("/api/file-sync/record", body.dump(), &response_body)) {
        cache_bundle_from_record(response_body);
    }
}

void FileSyncEntryStore::reset() {
    if (post_json("/api/file-sync/reset", "{}", nullptr)) {
        std::lock_guard<std::mutex> lock(mu_);
        local_entries_.clear();
        remote_entries_.clear();
        sync_entries_.clear();
        local_paths_.clear();
        remote_paths_.clear();
        provider_ids_.clear();
    }
}

std::optional<FileSyncLocalEntry> FileSyncEntryStore::local(FileSyncEntryId entry_id) const {
    {
        std::lock_guard<std::mutex> lock(mu_);
        const auto it = local_entries_.find(entry_id);
        if (it != local_entries_.end()) {
            return it->second;
        }
    }
    return fetch_local(entry_id);
}

std::optional<FileSyncRemoteEntry> FileSyncEntryStore::remote(FileSyncEntryId entry_id) const {
    {
        std::lock_guard<std::mutex> lock(mu_);
        const auto it = remote_entries_.find(entry_id);
        if (it != remote_entries_.end()) {
            return it->second;
        }
    }
    return fetch_remote(entry_id);
}

std::optional<FileSyncEntry> FileSyncEntryStore::sync(FileSyncEntryId entry_id) const {
    {
        std::lock_guard<std::mutex> lock(mu_);
        const auto it = sync_entries_.find(entry_id);
        if (it != sync_entries_.end()) {
            return it->second;
        }
    }
    return fetch_sync(entry_id);
}

std::optional<FileSyncEntryId> FileSyncEntryStore::local_id(const std::string& path) const {
    {
        std::lock_guard<std::mutex> lock(mu_);
        const auto it = local_paths_.find(path);
        if (it != local_paths_.end()) {
            return it->second;
        }
    }
    return fetch_id(proxy_url("/api/file-sync/local/id?path=" + url_encode(path)));
}

std::optional<FileSyncEntryId> FileSyncEntryStore::remote_id(const std::string& remote_name,
                                                             const std::string& path) const {
    {
        std::lock_guard<std::mutex> lock(mu_);
        const auto it = remote_paths_.find(remote_key(remote_name, path));
        if (it != remote_paths_.end()) {
            return it->second;
        }
    }
    return fetch_id(proxy_url("/api/file-sync/remote/id?remote=" + url_encode(remote_name) +
                              "&path=" + url_encode(path)));
}

std::optional<FileSyncEntryId> FileSyncEntryStore::provider_id(const std::string& provider_file_id) const {
    {
        std::lock_guard<std::mutex> lock(mu_);
        const auto it = provider_ids_.find(provider_file_id);
        if (it != provider_ids_.end()) {
            return it->second;
        }
    }
    return fetch_id(proxy_url("/api/file-sync/provider/id?provider_file_id=" + url_encode(provider_file_id)));
}

std::unordered_map<std::string, FileSyncEntryState> FileSyncEntryStore::local_states(const std::vector<std::string>& paths) const {
    std::unordered_map<std::string, FileSyncEntryState> out;
    if (paths.empty()) {
        return out;
    }

    nlohmann::json body;
    body["local_paths"] = paths;
    body["remote_paths"] = nlohmann::json::array();

    std::string response_body;
    if (!post_json("/api/file-sync/states/resolve", body.dump(), &response_body)) {
        return out;
    }

    const auto json = nlohmann::json::parse(response_body, nullptr, false);
    if (!json.is_object() || !json.contains("local") || !json["local"].is_array()) {
        return out;
    }
    for (const auto& item : json["local"]) {
        const std::string path = item.value("local_path", std::string{});
        const std::string state = item.value("state", std::string{});
        if (!path.empty()) {
            out[path] = state_from_string(state);
        }
    }
    return out;
}

std::unordered_map<std::string, FileSyncEntryState> FileSyncEntryStore::remote_states(const std::vector<FileSyncRemotePathRef>& refs) const {
    std::unordered_map<std::string, FileSyncEntryState> out;
    if (refs.empty()) {
        return out;
    }

    nlohmann::json remote_paths = nlohmann::json::array();
    for (const auto& ref : refs) {
        remote_paths.push_back({
            {"remote_name", ref.remote_name},
            {"remote_path", ref.remote_path},
        });
    }
    nlohmann::json body;
    body["local_paths"] = nlohmann::json::array();
    body["remote_paths"] = remote_paths;

    std::string response_body;
    if (!post_json("/api/file-sync/states/resolve", body.dump(), &response_body)) {
        return out;
    }

    const auto json = nlohmann::json::parse(response_body, nullptr, false);
    if (!json.is_object() || !json.contains("remote") || !json["remote"].is_array()) {
        return out;
    }
    for (const auto& item : json["remote"]) {
        const std::string remote_name = item.value("remote_name", std::string{});
        const std::string remote_path = item.value("remote_path", std::string{});
        const std::string state = item.value("state", std::string{});
        if (!remote_name.empty() && !remote_path.empty()) {
            out[remote_key(remote_name, remote_path)] = state_from_string(state);
        }
    }
    return out;
}

std::optional<FileSyncLocalEntry> FileSyncEntryStore::fetch_local(const FileSyncEntryId& entry_id) const {
    const std::string url = proxy_url("/api/file-sync/local?entry_id=" + url_encode(entry_id));
    if (url.empty()) {
        return std::nullopt;
    }
    HttpResponse response = HTTPClient::get().get(url);
    if (!response_ok(response)) {
        return std::nullopt;
    }
    auto entry = parse_entry_body<FileSyncLocalEntry>(response.body);
    if (entry) {
        cache_local_entry(*entry);
    }
    return entry;
}

std::optional<FileSyncRemoteEntry> FileSyncEntryStore::fetch_remote(const FileSyncEntryId& entry_id) const {
    const std::string url = proxy_url("/api/file-sync/remote?entry_id=" + url_encode(entry_id));
    if (url.empty()) {
        return std::nullopt;
    }
    HttpResponse response = HTTPClient::get().get(url);
    if (!response_ok(response)) {
        return std::nullopt;
    }
    auto entry = parse_entry_body<FileSyncRemoteEntry>(response.body);
    if (entry) {
        cache_remote_entry(*entry);
    }
    return entry;
}

std::optional<FileSyncEntry> FileSyncEntryStore::fetch_sync(const FileSyncEntryId& entry_id) const {
    const std::string url = proxy_url("/api/file-sync/sync?entry_id=" + url_encode(entry_id));
    if (url.empty()) {
        return std::nullopt;
    }
    HttpResponse response = HTTPClient::get().get(url);
    if (!response_ok(response)) {
        return std::nullopt;
    }
    auto entry = parse_entry_body<FileSyncEntry>(response.body);
    if (entry) {
        cache_sync_entry(*entry);
    }
    return entry;
}

std::optional<FileSyncEntryId> FileSyncEntryStore::fetch_id(const std::string& url) const {
    if (url.empty()) {
        return std::nullopt;
    }
    HttpResponse response = HTTPClient::get().get(url);
    if (!response_ok(response)) {
        return std::nullopt;
    }
    const auto json = nlohmann::json::parse(response.body, nullptr, false);
    if (!json.is_object() || !json.contains("entry_id") || json["entry_id"].is_null()) {
        return std::nullopt;
    }
    return json["entry_id"].get<std::string>();
}

void FileSyncEntryStore::cache_local_entry(const FileSyncLocalEntry& entry) const {
    std::lock_guard<std::mutex> lock(mu_);
    const auto old = local_entries_.find(entry.entry_id);
    if (old != local_entries_.end() && !old->second.local_path.empty()) {
        local_paths_.erase(old->second.local_path);
    }
    local_entries_[entry.entry_id] = entry;
    if (!entry.local_path.empty()) {
        local_paths_[entry.local_path] = entry.entry_id;
    }
}

void FileSyncEntryStore::cache_remote_entry(const FileSyncRemoteEntry& entry) const {
    std::lock_guard<std::mutex> lock(mu_);
    const auto old = remote_entries_.find(entry.entry_id);
    if (old != remote_entries_.end()) {
        if (!old->second.remote_path.empty()) {
            remote_paths_.erase(remote_key(old->second.remote_name, old->second.remote_path));
        }
        if (!old->second.provider_file_id.empty()) {
            provider_ids_.erase(old->second.provider_file_id);
        }
    }
    remote_entries_[entry.entry_id] = entry;
    if (!entry.remote_name.empty() && !entry.remote_path.empty()) {
        remote_paths_[remote_key(entry.remote_name, entry.remote_path)] = entry.entry_id;
    }
    if (!entry.provider_file_id.empty()) {
        provider_ids_[entry.provider_file_id] = entry.entry_id;
    }
}

void FileSyncEntryStore::cache_sync_entry(const FileSyncEntry& entry) const {
    std::lock_guard<std::mutex> lock(mu_);
    sync_entries_[entry.entry_id] = entry;
}

void FileSyncEntryStore::cache_bundle_from_record(const std::string& body) const {
    const auto json = nlohmann::json::parse(body, nullptr, false);
    if (!json.is_object()) {
        return;
    }
    if (json.contains("local") && json["local"].is_object()) {
        cache_local_entry(json["local"].get<FileSyncLocalEntry>());
    }
    if (json.contains("remote") && json["remote"].is_object()) {
        cache_remote_entry(json["remote"].get<FileSyncRemoteEntry>());
    }
    if (json.contains("sync") && json["sync"].is_object()) {
        cache_sync_entry(json["sync"].get<FileSyncEntry>());
    }
}

bool FileSyncEntryStore::post_json(const std::string& path,
                                   const std::string& body,
                                   std::string* response_body) const {
    const std::string url = proxy_url(path);
    if (url.empty()) {
        return false;
    }

    HttpRequestOptions options;
    options.headers["Content-Type"] = "application/json";
    options.headers["Accept"] = "application/json";
    options.timeouts.connect_timeout_seconds = 1L;
    options.timeouts.total_timeout_seconds = 2L;
    HttpResponse response = HTTPClient::get().post(url, body, options);
    if (!response_ok(response)) {
        return false;
    }
    if (response_body != nullptr) {
        *response_body = response.body;
    }
    return true;
}

std::string FileSyncEntryStore::proxy_url(const std::string& path) const {
    const std::string base = EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (base.empty()) {
        return "";
    }
    return base + path;
}

} // namespace misty::core
