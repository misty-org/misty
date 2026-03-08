#include <gtest/gtest.h>

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <nlohmann/json.hpp>
#include <string>
#include <thread>

#include "core/file_sync/file_sync_gate.h"
#include "core/manager/env_manager.h"

namespace {

class FakeFileSyncProxy {
public:
    FakeFileSyncProxy() = default;
    ~FakeFileSyncProxy() { stop(); }

    void start() {
        server_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
        ASSERT_GE(server_fd_, 0);
        int opt = 1;
        ASSERT_EQ(::setsockopt(server_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)), 0);

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;
        ASSERT_EQ(::bind(server_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)), 0);
        ASSERT_EQ(::listen(server_fd_, 16), 0);

        socklen_t len = sizeof(addr);
        ASSERT_EQ(::getsockname(server_fd_, reinterpret_cast<sockaddr*>(&addr), &len), 0);
        port_ = ntohs(addr.sin_port);
        running_.store(true);
        thread_ = std::thread([this] { serve_loop(); });
    }

    void stop() {
        if (!running_.exchange(false)) {
            return;
        }
        ::shutdown(server_fd_, SHUT_RDWR);
        ::close(server_fd_);
        server_fd_ = -1;
        if (thread_.joinable()) {
            thread_.join();
        }
    }

    std::string url() const {
        return "http://127.0.0.1:" + std::to_string(port_);
    }

    void configure_env() const {
        const auto dir = std::filesystem::temp_directory_path() / "misty-file-sync-test";
        std::filesystem::create_directories(dir);
        const auto path = dir / "misty.json";
        std::ofstream out(path);
        out << "{\"proxy\":{\"port\":" << port_ << "}}";
        out.close();
        misty::core::EnvManager::get().set_env_file_path(path.string());
        misty::core::EnvManager::get().reload();
    }

    void seed_local(const nlohmann::json& local) {
        std::lock_guard<std::mutex> lock(mu_);
        local_entries_[local.value("entry_id", std::string{})] = local;
        local_paths_[local.value("local_path", std::string{})] = local.value("entry_id", std::string{});
    }

    void seed_remote(const nlohmann::json& remote) {
        std::lock_guard<std::mutex> lock(mu_);
        remote_entries_[remote.value("entry_id", std::string{})] = remote;
        remote_paths_[remote_key(remote.value("remote_name", std::string{}),
                                 remote.value("remote_path", std::string{}))] =
            remote.value("entry_id", std::string{});
    }

    void seed_sync(const nlohmann::json& sync) {
        std::lock_guard<std::mutex> lock(mu_);
        sync_entries_[sync.value("entry_id", std::string{})] = sync;
    }

    int local_get_count() const { return local_get_count_.load(); }

private:
    static std::string remote_key(const std::string& remote_name, const std::string& remote_path) {
        return remote_name + ":" + remote_path;
    }

    static std::string read_all(int fd) {
        std::string data;
        char buffer[4096];
        while (true) {
            const ssize_t n = ::recv(fd, buffer, sizeof(buffer), 0);
            if (n <= 0) {
                break;
            }
            data.append(buffer, static_cast<std::size_t>(n));
            const auto header_end = data.find("\r\n\r\n");
            if (header_end == std::string::npos) {
                continue;
            }
            const auto content_length_pos = data.find("Content-Length:");
            if (content_length_pos == std::string::npos) {
                break;
            }
            const auto line_end = data.find("\r\n", content_length_pos);
            const std::size_t value_start = content_length_pos + std::string("Content-Length:").size();
            const std::size_t content_length = static_cast<std::size_t>(std::stoul(data.substr(value_start, line_end - value_start)));
            if (data.size() >= header_end + 4 + content_length) {
                break;
            }
        }
        return data;
    }

    static std::string url_decode(std::string value) {
        std::string out;
        out.reserve(value.size());
        for (std::size_t i = 0; i < value.size(); ++i) {
            if (value[i] == '%' && i + 2 < value.size()) {
                const std::string hex = value.substr(i + 1, 2);
                out.push_back(static_cast<char>(std::stoi(hex, nullptr, 16)));
                i += 2;
            } else if (value[i] == '+') {
                out.push_back(' ');
            } else {
                out.push_back(value[i]);
            }
        }
        return out;
    }

    static std::map<std::string, std::string> query_map(const std::string& path) {
        std::map<std::string, std::string> out;
        const auto q = path.find('?');
        if (q == std::string::npos) {
            return out;
        }
        std::string query = path.substr(q + 1);
        std::size_t start = 0;
        while (start <= query.size()) {
            const auto end = query.find('&', start);
            const std::string pair = query.substr(start, end == std::string::npos ? std::string::npos : end - start);
            const auto eq = pair.find('=');
            const std::string key = pair.substr(0, eq);
            const std::string value = eq == std::string::npos ? "" : pair.substr(eq + 1);
            out[key] = url_decode(value);
            if (end == std::string::npos) {
                break;
            }
            start = end + 1;
        }
        return out;
    }

    void send_json(int fd, int status, const nlohmann::json& body) {
        const std::string payload = body.dump();
        const std::string status_text = status == 200 ? "OK" : "Bad Request";
        const std::string response =
            "HTTP/1.1 " + std::to_string(status) + " " + status_text + "\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: " + std::to_string(payload.size()) + "\r\n"
            "Connection: close\r\n\r\n" + payload;
        (void)::send(fd, response.data(), response.size(), 0);
    }

    void upsert_local(const nlohmann::json& entry) {
        const std::string entry_id = entry.value("entry_id", std::string{});
        auto old = local_entries_.find(entry_id);
        if (old != local_entries_.end()) {
            local_paths_.erase(old->second.value("local_path", std::string{}));
        }
        local_entries_[entry_id] = entry;
        local_paths_[entry.value("local_path", std::string{})] = entry_id;
    }

    void serve_loop() {
        while (running_.load()) {
            const int client = ::accept(server_fd_, nullptr, nullptr);
            if (client < 0) {
                continue;
            }
            const std::string request = read_all(client);
            const auto header_end = request.find("\r\n\r\n");
            const std::string head = request.substr(0, header_end);
            const std::string body = header_end == std::string::npos ? "" : request.substr(header_end + 4);
            const auto line_end = head.find("\r\n");
            const std::string request_line = head.substr(0, line_end);
            const auto first_space = request_line.find(' ');
            const auto second_space = request_line.find(' ', first_space + 1);
            const std::string method = request_line.substr(0, first_space);
            const std::string path = request_line.substr(first_space + 1, second_space - first_space - 1);

            if (method == "GET" && path == "/api/session") {
                send_json(client, 200, {{"access_token", "token"}, {"id", "user-1"}, {"email", "user@example.com"}});
                ::close(client);
                continue;
            }

            if (method == "POST" && path == "/api/file-sync/local") {
                const auto json = nlohmann::json::parse(body, nullptr, false);
                std::lock_guard<std::mutex> lock(mu_);
                upsert_local(json);
                send_json(client, 200, json);
                ::close(client);
                continue;
            }

            if (method == "GET" && path.rfind("/api/file-sync/local?", 0) == 0) {
                ++local_get_count_;
                const auto query = query_map(path);
                std::lock_guard<std::mutex> lock(mu_);
                const auto it = local_entries_.find(query.at("entry_id"));
                send_json(client, 200, it == local_entries_.end() ? nlohmann::json(nullptr) : it->second);
                ::close(client);
                continue;
            }

            if (method == "GET" && path.rfind("/api/file-sync/local/id?", 0) == 0) {
                const auto query = query_map(path);
                std::lock_guard<std::mutex> lock(mu_);
                const auto it = local_paths_.find(query.at("path"));
                if (it == local_paths_.end()) {
                    send_json(client, 200, {{"entry_id", nullptr}});
                } else {
                    send_json(client, 200, {{"entry_id", it->second}});
                }
                ::close(client);
                continue;
            }

            if (method == "POST" && path == "/api/file-sync/states/resolve") {
                const auto json = nlohmann::json::parse(body, nullptr, false);
                nlohmann::json response = {
                    {"local", nlohmann::json::array()},
                    {"remote", nlohmann::json::array()},
                };
                std::lock_guard<std::mutex> lock(mu_);
                for (const auto& local_path : json.value("local_paths", nlohmann::json::array())) {
                    const std::string value = local_path.get<std::string>();
                    const auto id = local_paths_.find(value);
                    if (id == local_paths_.end()) {
                        continue;
                    }
                    const auto sync = sync_entries_.find(id->second);
                    response["local"].push_back({
                        {"local_path", value},
                        {"entry_id", id->second},
                        {"state", sync == sync_entries_.end() ? "LOC" : sync->second.value("state", "LOC")},
                    });
                }
                for (const auto& remote_ref : json.value("remote_paths", nlohmann::json::array())) {
                    const std::string remote_name = remote_ref.value("remote_name", std::string{});
                    const std::string remote_path = remote_ref.value("remote_path", std::string{});
                    const auto id = remote_paths_.find(remote_key(remote_name, remote_path));
                    if (id == remote_paths_.end()) {
                        continue;
                    }
                    const auto sync = sync_entries_.find(id->second);
                    response["remote"].push_back({
                        {"remote_name", remote_name},
                        {"remote_path", remote_path},
                        {"entry_id", id->second},
                        {"state", sync == sync_entries_.end() ? "REM" : sync->second.value("state", "REM")},
                    });
                }
                send_json(client, 200, response);
                ::close(client);
                continue;
            }

            send_json(client, 200, nlohmann::json(nullptr));
            ::close(client);
        }
    }

    int server_fd_ = -1;
    int port_ = 0;
    std::atomic<bool> running_{false};
    std::thread thread_;
    mutable std::mutex mu_;
    std::map<std::string, nlohmann::json> local_entries_;
    std::map<std::string, nlohmann::json> remote_entries_;
    std::map<std::string, nlohmann::json> sync_entries_;
    std::map<std::string, std::string> local_paths_;
    std::map<std::string, std::string> remote_paths_;
    std::atomic<int> local_get_count_{0};
};

misty::core::FileSyncFinalEvent upload_event(const std::string& path, const std::string& checksum) {
    misty::core::FileSyncFinalEvent event;
    event.change = misty::core::FileSyncChange::LocalFile;
    event.pending_event.new_path = path;
    event.data.content_hash = checksum;
    return event;
}

void synced_baseline(misty::core::FileSyncGate& gate,
                     misty::core::FileSyncEntryId id,
                     const std::string& path,
                     const std::string& checksum) {
    misty::core::FileSyncLocalEntry local;
    local.entry_id = id;
    local.local_path = path;
    local.exists = true;
    local.checksum = checksum;
    gate.entries().local(local);

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = path;
    remote.exists = true;
    remote.checksum = checksum;
    gate.entries().remote(remote);

    misty::core::FileSyncEntry sync;
    sync.entry_id = id;
    sync.state = misty::core::FileSyncEntryState::SYNC;
    sync.last_local_path = path;
    sync.last_local_checksum = checksum;
    sync.last_remote_path = path;
    sync.last_remote_checksum = checksum;
    gate.entries().sync(sync);
}

TEST(FileSyncGateTest, BiDirectionalLocalOnlyUploadsLocal) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::BiDirectional);

    const auto out = gate.result(upload_event("/tmp/local-only.txt", "local-1"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::UploadLocal);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::None);
}

TEST(FileSyncGateTest, BiDirectionalBothSidesChangedConflictsWithoutTimestampJudgement) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::BiDirectional);
    const misty::core::FileSyncEntryId id = "11111111-1111-4111-8111-111111111111";
    synced_baseline(gate, id, "/tmp/both-changed.txt", "base");

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = "/tmp/both-changed.txt";
    remote.exists = true;
    remote.checksum = "remote-new";
    remote.last_modified = "2999-01-01T00:00:00Z";
    gate.entries().remote(remote);

    const auto out = gate.result(upload_event("/tmp/both-changed.txt", "local-new"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::Conflict);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::None);
}

TEST(FileSyncGateTest, LocalFirstKeepsLocalAndRequestsRemotePreview) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::LocalFirst);
    const misty::core::FileSyncEntryId id = "22222222-2222-4222-8222-222222222222";
    synced_baseline(gate, id, "/tmp/local-first.txt", "base");

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = "/tmp/local-first.txt";
    remote.exists = true;
    remote.checksum = "remote-new";
    gate.entries().remote(remote);

    const auto out = gate.result(upload_event("/tmp/local-first.txt", "local-new"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::UploadLocal);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::RemoteTmp);
}

TEST(FileSyncGateTest, RemoteFirstKeepsRemoteAndRequestsLocalPreview) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::RemoteFirst);
    const misty::core::FileSyncEntryId id = "33333333-3333-4333-8333-333333333333";
    synced_baseline(gate, id, "/tmp/remote-first.txt", "base");

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = "/tmp/remote-first.txt";
    remote.exists = true;
    remote.checksum = "remote-new";
    gate.entries().remote(remote);

    const auto out = gate.result(upload_event("/tmp/remote-first.txt", "local-new"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::DownloadRemote);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::LocalTmp);
}

TEST(FileSyncGateTest, RenameKeepsStableEntryId) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::BiDirectional);
    const misty::core::FileSyncEntryId id = "77777777-7777-4777-8777-777777777777";
    synced_baseline(gate, id, "/tmp/before.txt", "base");

    misty::core::FileSyncFinalEvent event = upload_event("/tmp/after.txt", "after");
    event.change = misty::core::FileSyncChange::LocalRename;
    event.pending_event.old_path = "/tmp/before.txt";

    const auto out = gate.result(event);

    EXPECT_EQ(out.action, misty::core::FileSyncAction::RenameRemote);
    ASSERT_TRUE(gate.entries().local_id("/tmp/after.txt").has_value());
    EXPECT_EQ(*gate.entries().local_id("/tmp/after.txt"), id);
}

TEST(FileSyncGateTest, RemoteOnlyBaselineRemainsRemote) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::BiDirectional);
    const misty::core::FileSyncEntryId id = "44444444-4444-4444-8444-444444444444";

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = "docs/remote-only.txt";
    remote.exists = true;
    remote.checksum = "remote-only";
    gate.entries().remote(remote);

    misty::core::FileSyncFinalEvent event;
    event.change = misty::core::FileSyncChange::RemoteFile;
    event.remote_name = "remote";
    event.pending_event.new_path = "docs/remote-only.txt";
    event.data.content_hash = "remote-only";

    const auto out = gate.result(event);
    EXPECT_EQ(out.action, misty::core::FileSyncAction::Noop);
}

TEST(FileSyncEntryStoreTest, CacheMissThenHitUsesProxyState) {
    FakeFileSyncProxy proxy;
    proxy.start();
    proxy.configure_env();
    proxy.seed_local({
        {"entry_id", "entry-cache"},
        {"local_path", "/tmp/cache.txt"},
        {"exists", true},
        {"is_dir", false},
        {"size", 7}
    });

    misty::core::FileSyncEntryStore store;
    auto first = store.local("entry-cache");
    ASSERT_TRUE(first.has_value());
    auto second = store.local("entry-cache");
    ASSERT_TRUE(second.has_value());
    EXPECT_EQ(first->local_path, "/tmp/cache.txt");
    EXPECT_EQ(second->local_path, "/tmp/cache.txt");
    EXPECT_EQ(proxy.local_get_count(), 1);
}

TEST(FileSyncEntryStoreTest, ProxyBackedStatePersistsAcrossStoreInstances) {
    FakeFileSyncProxy proxy;
    proxy.start();
    proxy.configure_env();

    misty::core::FileSyncEntryStore writer;
    misty::core::FileSyncLocalEntry local;
    local.entry_id = "entry-persist";
    local.local_path = "/tmp/persist.txt";
    local.exists = true;
    writer.local(local);

    misty::core::FileSyncEntryStore reader;
    auto loaded = reader.local("entry-persist");
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->local_path, "/tmp/persist.txt");
}

TEST(FileSyncEntryStoreTest, BulkStateLookupParsesLocalAndRemoteStates) {
    FakeFileSyncProxy proxy;
    proxy.start();
    proxy.configure_env();
    proxy.seed_local({
        {"entry_id", "entry-sync"},
        {"local_path", "/tmp/sync.txt"},
        {"exists", true},
    });
    proxy.seed_remote({
        {"entry_id", "entry-remote"},
        {"remote_name", "remote"},
        {"remote_path", "docs/remote.txt"},
        {"exists", true},
    });
    proxy.seed_remote({
        {"entry_id", "entry-conflict"},
        {"remote_name", "remote"},
        {"remote_path", "docs/conflict.txt"},
        {"exists", true},
    });
    proxy.seed_sync({
        {"entry_id", "entry-sync"},
        {"state", "SYNC"},
    });
    proxy.seed_sync({
        {"entry_id", "entry-conflict"},
        {"state", "CONFLICT"},
    });

    misty::core::FileSyncEntryStore store;
    const auto local_states = store.local_states({"/tmp/sync.txt", "/tmp/missing.txt"});
    ASSERT_EQ(local_states.at("/tmp/sync.txt"), misty::core::FileSyncEntryState::SYNC);
    EXPECT_EQ(local_states.count("/tmp/missing.txt"), 0u);

    const auto remote_states = store.remote_states({
        {"remote", "docs/remote.txt"},
        {"remote", "docs/conflict.txt"},
        {"remote", "docs/missing.txt"},
    });
    EXPECT_EQ(remote_states.at("remote:docs/remote.txt"), misty::core::FileSyncEntryState::REM);
    EXPECT_EQ(remote_states.at("remote:docs/conflict.txt"), misty::core::FileSyncEntryState::CONFLICT);
    EXPECT_EQ(remote_states.count("remote:docs/missing.txt"), 0u);
}

} // namespace
