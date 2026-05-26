#include "core/file_sync/file_sync_poller.h"

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"

namespace misty::core {
namespace {

bool response_ok(const HttpResponse& response) {
    return response.status_code >= 200 && response.status_code < 300;
}

std::string target_key(const FileSyncRemoteTarget& target) {
    return target.remote_name + ":" + target.remote_path;
}

std::string identity_key(const FileSyncRemoteEntry& entry) {
    if (!entry.provider_file_id.empty()) {
        return "provider:" + entry.provider_file_id;
    }
    return "path:" + entry.remote_path;
}

std::string proxy_url(const std::string& path) {
    const std::string base = EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (base.empty()) {
        return "";
    }
    return base + path;
}

bool remote_entry_changed(const FileSyncRemoteEntry& old_entry, const FileSyncRemoteEntry& new_entry) {
    return old_entry.exists != new_entry.exists ||
           old_entry.is_dir != new_entry.is_dir ||
           old_entry.size != new_entry.size ||
           old_entry.last_modified != new_entry.last_modified ||
           old_entry.checksum != new_entry.checksum;
}

FileSyncChange event_change_for_entry(const FileSyncRemoteEntry& entry) {
    return entry.is_dir ? FileSyncChange::RemoteFolder : FileSyncChange::RemoteFile;
}

} // namespace

FileSyncRemotePoller::~FileSyncRemotePoller() {
    stop();
}

bool FileSyncRemotePoller::start(std::vector<FileSyncRemoteTarget> targets,
                                 FileSyncRemoteCallback callback,
                                 std::chrono::milliseconds interval) {
    stop();
    if (interval <= std::chrono::milliseconds::zero()) {
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mu_);
        targets_ = std::move(targets);
        callback_ = std::move(callback);
        interval_ = interval;
        last_seen_.clear();
    }

    running_.store(true);
    thread_ = std::thread(&FileSyncRemotePoller::poll_loop, this);
    return true;
}

void FileSyncRemotePoller::stop() {
    if (!running_.exchange(false)) {
        return;
    }
    cv_.notify_all();
    if (thread_.joinable()) {
        thread_.join();
    }
    {
        std::lock_guard<std::mutex> lock(mu_);
        callback_ = nullptr;
        targets_.clear();
        last_seen_.clear();
    }
}

bool FileSyncRemotePoller::running() const {
    return running_.load();
}

void FileSyncRemotePoller::poll_loop() {
    while (running_.load()) {
        auto events = poll_targets();
        FileSyncRemoteCallback callback;
        {
            std::lock_guard<std::mutex> lock(mu_);
            callback = callback_;
        }
        if (callback && !events.empty()) {
            callback(std::move(events));
        }

        std::unique_lock<std::mutex> lock(mu_);
        cv_.wait_for(lock, interval_, [this] {
            return !running_.load();
        });
    }
}

std::vector<FileSyncRemoteEvent> FileSyncRemotePoller::poll_targets() {
    std::vector<FileSyncRemoteTarget> targets;
    {
        std::lock_guard<std::mutex> lock(mu_);
        targets = targets_;
    }

    std::vector<FileSyncRemoteEvent> events;
    for (const auto& target : targets) {
        const std::string url = proxy_url("/api/file-sync/remote/scan?remote=" + url_encode(target.remote_name) +
                                          "&path=" + url_encode(target.remote_path));
        if (url.empty()) {
            continue;
        }

        HttpResponse response = HTTPClient::get().get(url);
        if (!response_ok(response)) {
            continue;
        }

        const auto json = nlohmann::json::parse(response.body, nullptr, false);
        if (!json.is_array()) {
            continue;
        }

        std::unordered_map<std::string, FileSyncRemoteEntry> current;
        for (const auto& item : json) {
            if (!item.is_object()) {
                continue;
            }
            FileSyncRemoteEntry entry = item.get<FileSyncRemoteEntry>();
            current[identity_key(entry)] = entry;
        }

        std::lock_guard<std::mutex> lock(mu_);
        auto& previous = last_seen_[target_key(target)];

        for (const auto& [identity, entry] : current) {
            const auto old = previous.find(identity);
            if (old == previous.end()) {
                events.push_back(FileSyncRemoteEvent{event_change_for_entry(entry), entry, ""});
                continue;
            }
            if (old->second.remote_path != entry.remote_path) {
                events.push_back(FileSyncRemoteEvent{FileSyncChange::RemoteRename, entry, old->second.remote_path});
                continue;
            }
            if (remote_entry_changed(old->second, entry)) {
                events.push_back(FileSyncRemoteEvent{event_change_for_entry(entry), entry, ""});
            }
        }

        for (const auto& [identity, entry] : previous) {
            if (current.find(identity) != current.end()) {
                continue;
            }
            FileSyncRemoteEntry deleted = entry;
            deleted.exists = false;
            events.push_back(FileSyncRemoteEvent{FileSyncChange::RemoteDelete, deleted, entry.remote_path});
        }

        previous = std::move(current);
    }
    return events;
}

} // namespace misty::core
