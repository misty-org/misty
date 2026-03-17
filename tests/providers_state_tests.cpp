#include <gtest/gtest.h>

#include <algorithm>
#include <arpa/inet.h>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <mutex>
#include <netinet/in.h>
#include <optional>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <vector>

#include "core/manager/env_manager.h"
#include "core/threading/worker_pool.h"
#include "panels/providers/state/providers_state.h"
#include "panels/providers/state/providers_state_util.h"

namespace fs = std::filesystem;

namespace misty::panel {
bool is_onedrive_provider_type(const std::string&) {
    return false;
}

bool status_needs_onedrive_drive_repair(const ProviderRemoteStatus*) {
    return false;
}

std::vector<ProviderOption> onedrive_drive_repair_options() {
    return {};
}

std::vector<ProviderOption> onedrive_visible_drive_repair_options(const ActiveProviderConfigSession&) {
    return {};
}
}  // namespace misty::panel

namespace {

struct TempHome {
    TempHome() {
        const char* current = std::getenv("HOME");
        if (current) {
            old_home_ = current;
        }
        path_ = fs::temp_directory_path() /
                fs::path("misty-provider-tests-" +
                         std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        fs::create_directories(path_);
        setenv("HOME", path_.c_str(), 1);
    }

    ~TempHome() {
        if (old_home_.has_value()) {
            setenv("HOME", old_home_->c_str(), 1);
        } else {
            unsetenv("HOME");
        }
        std::error_code ec;
        fs::remove_all(path_, ec);
    }

    fs::path path() const { return path_; }

private:
    fs::path path_;
    std::optional<std::string> old_home_;
};

void write_file(const fs::path& path, const std::string& body) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    ASSERT_TRUE(out.is_open());
    out << body;
}

bool wait_for(const std::function<bool()>& predicate,
              std::chrono::milliseconds timeout = std::chrono::milliseconds(2000)) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (predicate()) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return predicate();
}

class FakeProviderServer {
public:
    struct Request {
        std::string method;
        std::string target;
        std::string body;
    };

    ~FakeProviderServer() { stop(); }

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
        running_ = true;
        thread_ = std::thread([this]() { serve_loop(); });
    }

    void stop() {
        if (!running_) {
            return;
        }
        running_ = false;
        ::shutdown(server_fd_, SHUT_RDWR);
        ::close(server_fd_);
        server_fd_ = -1;
        if (thread_.joinable()) {
            thread_.join();
        }
    }

    void configure_env(const fs::path& home) const {
        const fs::path config = home / "misty.json";
        write_file(config, "{\"proxy\":{\"port\":" + std::to_string(port_) + "}}");
        misty::core::EnvManager::get().set_env_file_path(config.string());
        misty::core::EnvManager::get().reload();
    }

    void fail_create() {
        std::lock_guard<std::mutex> lock(mu_);
        fail_create_ = true;
    }

    void fail_update() {
        std::lock_guard<std::mutex> lock(mu_);
        fail_update_ = true;
    }

    void fail_about() {
        std::lock_guard<std::mutex> lock(mu_);
        fail_about_ = true;
    }

    std::vector<Request> requests() const {
        std::lock_guard<std::mutex> lock(mu_);
        return requests_;
    }

private:
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
            std::size_t content_length = 0;
            const std::string headers = data.substr(0, header_end);
            const std::string key = "Content-Length:";
            const auto pos = headers.find(key);
            if (pos != std::string::npos) {
                const auto start = pos + key.size();
                const auto end = headers.find("\r\n", start);
                content_length = static_cast<std::size_t>(std::stoul(headers.substr(start, end - start)));
            }
            if (data.size() >= header_end + 4 + content_length) {
                break;
            }
        }
        return data;
    }

    static void write_response(int fd, int status, const std::string& body) {
        const char* reason = status >= 400 ? "Bad Request" : "OK";
        std::ostringstream out;
        out << "HTTP/1.1 " << status << " " << reason << "\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Connection: close\r\n\r\n"
            << body;
        const std::string response = out.str();
        (void)::send(fd, response.data(), response.size(), 0);
    }

    static bool body_contains(const std::string& body, const std::string& value) {
        return body.find("\"" + value + "\"") != std::string::npos ||
               body.find(value) != std::string::npos;
    }

    std::string remotes_json_locked() const {
        std::ostringstream out;
        out << "{\"remotes\":[";
        for (std::size_t i = 0; i < remotes_.size(); ++i) {
            if (i > 0) {
                out << ",";
            }
            out << "\"" << remotes_[i] << ":\"";
        }
        out << "]}";
        return out.str();
    }

    std::string connected_remotes_json_locked() const {
        return "[{\"name\":\"" + provider_name_ + "\",\"type\":\"drive\"}]";
    }

    std::string connected_remote_status_json_locked() const {
        return "[{\"name\":\"" + provider_name_ +
               "\",\"type\":\"drive\",\"status_label\":\"Connected\",\"needs_reconnect\":false}]";
    }

    void serve_loop() {
        while (running_) {
            const int client = ::accept(server_fd_, nullptr, nullptr);
            if (client < 0) {
                continue;
            }
            handle_client(client);
            ::close(client);
        }
    }

    void handle_client(int client) {
        const std::string raw = read_all(client);
        if (raw.empty()) {
            return;
        }
        const auto line_end = raw.find("\r\n");
        std::istringstream line(raw.substr(0, line_end));
        Request request;
        line >> request.method >> request.target;
        const auto header_end = raw.find("\r\n\r\n");
        if (header_end != std::string::npos) {
            request.body = raw.substr(header_end + 4);
        }

        int status = 200;
        std::string body = "{\"ok\":true}";
        {
            std::lock_guard<std::mutex> lock(mu_);
            requests_.push_back(request);
            if (request.target == "/api/session") {
                body = "{\"token\":\"test-token\"}";
            } else if (request.target == "/api/remote/health") {
                body = "{\"ready\":true,\"port\":\"" + std::to_string(port_) +
                       "\",\"connected_providers\":1,\"available_providers\":1}";
            } else if (request.target == "/api/remote/workflows") {
                body = "[]";
            } else if (request.target == "/api/remote") {
                body = connected_remotes_json_locked();
            } else if (request.target == "/api/remote/status") {
                body = connected_remote_status_json_locked();
            } else if (request.target == "/api/remote/rename") {
                if (fail_create_) {
                    status = 500;
                    body = "{\"error\":\"create failed\"}";
                } else if (!body_contains(request.body, "drive-old") || !body_contains(request.body, "drive-new")) {
                    status = 400;
                    body = "{\"error\":\"invalid rename request\"}";
                } else {
                    provider_name_ = "drive-new";
                    auto it = std::find(remotes_.begin(), remotes_.end(), "drive-old");
                    if (it != remotes_.end()) {
                        *it = "drive-new";
                    }
                    body = "{\"ok\":true,\"old_name\":\"drive-old\",\"new_name\":\"drive-new\"}";
                }
            } else if (request.target == "/config/listremotes") {
                body = remotes_json_locked();
            } else if (request.target == "/config/dump") {
                body = "{\"drive-old\":{\"type\":\"drive\",\"token\":\"abc\",\"scope\":\"drive\",\"root_folder_id\":\"root\"}}";
            } else if (request.target == "/config/get") {
                if (body_contains(request.body, provider_name_)) {
                    body = "{\"type\":\"drive\",\"token\":\"" + token_ +
                           "\",\"scope\":\"" + scope_ +
                           "\",\"root_folder_id\":\"" + root_folder_id_ + "\"}";
                } else {
                    status = 404;
                    body = "{\"error\":\"remote not found\"}";
                }
            } else if (request.target == "/config/update") {
                if (fail_update_) {
                    status = 500;
                    body = "{\"error\":\"update failed\"}";
                } else {
                    if (body_contains(request.body, "scope-new")) {
                        scope_ = "scope-new";
                    }
                    if (body_contains(request.body, "root-new")) {
                        root_folder_id_ = "root-new";
                    }
                    if (body_contains(request.body, "token-new")) {
                        token_ = "token-new";
                    }
                    body = "{\"ok\":true}";
                }
            } else if (request.target == "/operations/about") {
                if (fail_about_) {
                    status = 500;
                    body = "{\"error\":\"about failed\"}";
                } else {
                    body = "{\"total\":1000,\"used\":250,\"free\":750}";
                }
            } else if (request.target == "/config/paths") {
                body = "{\"config\":\"/tmp/rclone.conf\",\"cache\":\"/tmp\",\"temp\":\"/tmp\"}";
            } else if (request.target == "/config/create") {
                if (fail_create_) {
                    status = 500;
                    body = "{\"error\":\"create failed\"}";
                } else {
                    remotes_.push_back("drive-new");
                    body = "{\"ok\":true}";
                }
            } else if (request.target == "/config/delete") {
                remotes_.erase(std::remove(remotes_.begin(), remotes_.end(), "drive-old"), remotes_.end());
                body = "{\"ok\":true}";
            }
        }
        write_response(client, status, body);
    }

    int server_fd_ = -1;
    int port_ = 0;
    std::atomic<bool> running_{false};
    std::thread thread_;
    mutable std::mutex mu_;
    std::vector<Request> requests_;
    std::vector<std::string> remotes_ = {"drive-old", "other"};
    std::string provider_name_ = "drive-old";
    std::string token_ = "abc";
    std::string scope_ = "drive";
    std::string root_folder_id_ = "root";
    bool fail_create_ = false;
    bool fail_update_ = false;
    bool fail_about_ = false;
};

}  // namespace

TEST(ProviderRenameValidationTest, RejectsInvalidNames) {
    const std::vector<std::string> existing = {"drive-old", "other"};

    EXPECT_FALSE(misty::panel::provider_rename_validation_error("drive-old", "drive-new", existing).size());
    EXPECT_EQ(misty::panel::provider_rename_validation_error("drive-old", "", existing), "Enter a remote name.");
    EXPECT_EQ(misty::panel::provider_rename_validation_error("drive-old", "drive-old", existing),
              "Choose a different remote name.");
    EXPECT_EQ(misty::panel::provider_rename_validation_error("drive-old", "bad:name", existing),
              "Remote names cannot contain colons or path separators.");
    EXPECT_EQ(misty::panel::provider_rename_validation_error("drive-old", "bad/name", existing),
              "Remote names cannot contain colons or path separators.");
    EXPECT_EQ(misty::panel::provider_rename_validation_error("drive-old", "other", existing),
              "A remote with that name already exists.");
}

TEST(ProviderRenameValidationTest, ParsesRcloneRemoteNamesWithColons) {
    const auto names = misty::panel::parse_rclone_configured_remotes("{\"remotes\":[\"drive-old:\",\"other:\"]}");
    ASSERT_EQ(names.size(), 2u);
    EXPECT_EQ(names[0], "drive-old");
    EXPECT_EQ(names[1], "other");
}

TEST(ProviderTokenFieldsTest, ParsesAndUpdatesSerializedRcloneToken) {
    const std::string token =
        R"({"access_token":"access","token_type":"Bearer","refresh_token":"refresh","expiry":"2026-06-18T18:19:09Z","expires_in":3599})";

    const auto fields = misty::panel::parse_rclone_token_fields(token);
    ASSERT_EQ(fields.size(), 5u);
    EXPECT_EQ(fields[0].key, "access_token");
    EXPECT_EQ(fields[0].value, "access");
    EXPECT_TRUE(fields[0].sensitive);
    EXPECT_EQ(fields[1].key, "refresh_token");
    EXPECT_TRUE(fields[1].sensitive);
    EXPECT_EQ(fields[2].key, "token_type");
    EXPECT_FALSE(fields[2].sensitive);
    EXPECT_EQ(fields[3].key, "expiry");

    const std::string updated = misty::panel::update_rclone_token_field(token, "access_token", "new-access");
    const auto parsed = nlohmann::json::parse(updated);
    EXPECT_EQ(parsed.at("access_token"), "new-access");
    EXPECT_EQ(parsed.at("refresh_token"), "refresh");
    EXPECT_EQ(parsed.at("expires_in"), 3599);
}

TEST(ProvidersStateRenameTest, RenamesThroughProxy) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));

    state.on_request_rename("drive-old");
    state.set_pending_rename_name("drive-new");
    state.confirm_rename();

    ASSERT_TRUE(wait_for([&]() {
        std::lock_guard<std::mutex> lock(state.mu);
        return state.success_message.find("renamed") != std::string::npos;
    }));

    const auto cards = state.provider_cards_snapshot();
    ASSERT_EQ(cards.size(), 1u);
    EXPECT_EQ(cards.front().id, "drive-new");

    const auto requests = server.requests();
    auto has_target = [&](const char* target) {
        return std::any_of(requests.begin(), requests.end(), [&](const FakeProviderServer::Request& request) {
            return request.method == "POST" && request.target == target;
        });
    };
    EXPECT_TRUE(has_target("/api/remote/rename"));
    EXPECT_FALSE(has_target("/config/get"));
    EXPECT_FALSE(has_target("/config/create"));
    EXPECT_FALSE(has_target("/config/delete"));

    pool.shutdown();
}

TEST(ProvidersWorkspaceStateTest, SharesRemoteDataButKeepsViewStateIndependentAndDetectsStaleDrafts) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(2);
    misty::panel::ProvidersState shared;
    shared.init(pool);
    ASSERT_TRUE(wait_for([&]() { return !shared.provider_cards_snapshot().empty(); }));

    misty::panel::ProvidersState workspace;
    workspace.init(pool, false);
    workspace.attach_shared_state(&shared);
    workspace.sync_shared_data_from(shared);
    workspace.set_search_query("workspace-only");
    EXPECT_TRUE(shared.search_query().empty());
    ASSERT_EQ(workspace.provider_cards_snapshot().size(), 1u);

    workspace.set_search_query("");
    workspace.select_remote("drive-old");
    ASSERT_TRUE(wait_for([&]() { return !workspace.remote_edit_session_snapshot().loading; }));
    workspace.set_edit_field("scope", "drive.readonly");
    EXPECT_TRUE(workspace.remote_edit_session_snapshot().dirty);

    shared.on_request_rename("drive-old");
    shared.set_pending_rename_name("drive-new");
    shared.confirm_rename();
    ASSERT_TRUE(wait_for([&]() {
        const auto cards = shared.provider_cards_snapshot();
        return cards.size() == 1u && cards.front().id == "drive-new";
    }));

    workspace.sync_shared_data_from(shared);
    const auto edit = workspace.remote_edit_session_snapshot();
    EXPECT_TRUE(edit.dirty);
    EXPECT_TRUE(edit.stale);
    EXPECT_FALSE(edit.can_save);
    EXPECT_NE(edit.validation_error.find("another tab"), std::string::npos);

    workspace.prepare_for_workspace_close();
    const auto sanitized = workspace.remote_edit_session_snapshot();
    EXPECT_FALSE(sanitized.has_selection);
    EXPECT_TRUE(sanitized.edit_config.empty());
    EXPECT_TRUE(sanitized.original_config.empty());

    pool.shutdown();
}

TEST(ProvidersStateRenameTest, DoesNotDeleteOldRemoteWhenCreateFails) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.fail_create();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));

    state.on_request_rename("drive-old");
    state.set_pending_rename_name("drive-new");
    state.confirm_rename();

    ASSERT_TRUE(wait_for([&]() {
        return !state.rename_session_snapshot().validation_error.empty();
    }));

    const auto cards = state.provider_cards_snapshot();
    ASSERT_EQ(cards.size(), 1u);
    EXPECT_EQ(cards.front().id, "drive-old");

    const auto requests = server.requests();
    const bool saw_rename = std::any_of(requests.begin(), requests.end(), [](const FakeProviderServer::Request& request) {
        return request.method == "POST" && request.target == "/api/remote/rename";
    });
    const bool saw_delete = std::any_of(requests.begin(), requests.end(), [](const FakeProviderServer::Request& request) {
        return request.target == "/config/delete";
    });
    EXPECT_TRUE(saw_rename);
    EXPECT_FALSE(saw_delete);

    pool.shutdown();
}

TEST(ProvidersStateEditTest, LoadsSelectedRemoteConfig) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));

    state.select_remote("drive-old");

    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return session.has_selection && !session.loading && session.edit_config.count("token") > 0;
    }));

    const auto session = state.remote_edit_session_snapshot();
    EXPECT_EQ(session.selected_remote, "drive-old");
    EXPECT_EQ(session.original_remote_name, "drive-old");
    EXPECT_EQ(session.provider_type, "drive");
    EXPECT_EQ(session.edit_config.at("type"), "drive");
    EXPECT_EQ(session.edit_config.at("token"), "abc");
    EXPECT_EQ(session.edit_config.at("scope"), "drive");
    EXPECT_FALSE(session.dirty);
    EXPECT_FALSE(session.can_save);

    pool.shutdown();
}

TEST(ProvidersStateUiTest, TracksRemoteTabAndEditPanelVisibility) {
    misty::panel::ProvidersState state;

    EXPECT_EQ(state.selected_page_tab(), misty::panel::ProvidersPageTab::Remotes);
    EXPECT_TRUE(state.edit_panel_visible());

    state.hide_edit_panel();
    EXPECT_FALSE(state.edit_panel_visible());

    state.show_edit_panel();
    EXPECT_TRUE(state.edit_panel_visible());

    state.set_page_tab(misty::panel::ProvidersPageTab::Diagnostics);
    EXPECT_EQ(state.selected_page_tab(), misty::panel::ProvidersPageTab::Diagnostics);

    state.set_page_tab(misty::panel::ProvidersPageTab::Remotes);
    EXPECT_EQ(state.selected_page_tab(), misty::panel::ProvidersPageTab::Remotes);
}

TEST(ProvidersStateUiTest, DiagnosticsTabLoadsSafeConfigPaths) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.health_card_snapshot().port_text.empty();
    }));

    state.set_page_tab(misty::panel::ProvidersPageTab::Diagnostics);

    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.rclone_config_session_snapshot();
        return !session.loading && session.config_path == "/tmp/rclone.conf";
    }));

    const auto session = state.rclone_config_session_snapshot();
    EXPECT_EQ(session.config_path, "/tmp/rclone.conf");
    EXPECT_EQ(session.cache_path, "/tmp");
    EXPECT_EQ(session.temp_path, "/tmp");
    EXPECT_TRUE(session.error_message.empty());

    const auto requests = server.requests();
    const bool saw_paths = std::any_of(requests.begin(), requests.end(), [](const FakeProviderServer::Request& request) {
        return request.method == "POST" && request.target == "/config/paths";
    });
    EXPECT_TRUE(saw_paths);

    pool.shutdown();
}

TEST(ProvidersStateEditTest, SavesChangedConfigThroughRcloneUpdate) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));
    state.select_remote("drive-old");
    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return session.has_selection && !session.loading;
    }));

    state.set_edit_field("scope", "scope-new");
    EXPECT_TRUE(state.remote_edit_session_snapshot().can_save);
    state.save_selected_remote();

    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return !session.saving && session.success_message.find("saved") != std::string::npos;
    }));

    const auto session = state.remote_edit_session_snapshot();
    EXPECT_FALSE(session.dirty);
    EXPECT_FALSE(session.can_save);
    EXPECT_EQ(session.original_config.at("scope"), "scope-new");

    const auto requests = server.requests();
    const bool saw_update = std::any_of(requests.begin(), requests.end(), [](const FakeProviderServer::Request& request) {
        return request.method == "POST" &&
               request.target == "/config/update" &&
               request.body.find("scope-new") != std::string::npos;
    });
    EXPECT_TRUE(saw_update);

    pool.shutdown();
}

TEST(ProvidersStateEditTest, RenamesThenUpdatesConfigUsingNewName) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));
    state.select_remote("drive-old");
    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return session.has_selection && !session.loading;
    }));

    state.set_edit_remote_name("drive-new");
    state.set_edit_field("root_folder_id", "root-new");
    state.save_selected_remote();

    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return !session.saving && session.success_message.find("saved") != std::string::npos;
    }));

    const auto session = state.remote_edit_session_snapshot();
    EXPECT_EQ(session.selected_remote, "drive-new");
    EXPECT_EQ(session.original_remote_name, "drive-new");
    EXPECT_EQ(session.original_config.at("root_folder_id"), "root-new");

    const auto requests = server.requests();
    const bool saw_rename = std::any_of(requests.begin(), requests.end(), [](const FakeProviderServer::Request& request) {
        return request.method == "POST" && request.target == "/api/remote/rename";
    });
    const bool saw_update_new_name = std::any_of(requests.begin(), requests.end(), [](const FakeProviderServer::Request& request) {
        return request.method == "POST" &&
               request.target == "/config/update" &&
               request.body.find("drive-new") != std::string::npos &&
               request.body.find("root-new") != std::string::npos;
    });
    EXPECT_TRUE(saw_rename);
    EXPECT_TRUE(saw_update_new_name);

    pool.shutdown();
}

TEST(ProvidersStateEditTest, RejectsDuplicateEditRemoteName) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));
    state.select_remote("drive-old");
    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return session.has_selection && !session.loading;
    }));

    state.set_edit_remote_name("other");
    const auto session = state.remote_edit_session_snapshot();
    EXPECT_FALSE(session.can_save);
    EXPECT_EQ(session.validation_error, "A remote with that name already exists.");

    pool.shutdown();
}

TEST(ProvidersStateEditTest, FailedConfigUpdatePreservesDirtyEdits) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.fail_update();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));
    state.select_remote("drive-old");
    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return session.has_selection && !session.loading;
    }));

    state.set_edit_field("scope", "scope-new");
    state.save_selected_remote();

    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return !session.saving && session.error_message.find("update failed") != std::string::npos;
    }));

    const auto session = state.remote_edit_session_snapshot();
    EXPECT_TRUE(session.dirty);
    EXPECT_TRUE(session.can_save);
    EXPECT_EQ(session.edit_config.at("scope"), "scope-new");
    EXPECT_EQ(session.original_config.at("scope"), "drive");

    pool.shutdown();
}

TEST(ProvidersStateEditTest, TestConnectionReportsSuccessAndFailure) {
    TempHome home;
    FakeProviderServer server;
    server.start();
    server.configure_env(home.path());

    misty::core::WorkerPool pool(1);
    misty::panel::ProvidersState state;
    state.init(pool);

    ASSERT_TRUE(wait_for([&]() {
        return !state.provider_cards_snapshot().empty();
    }));
    state.select_remote("drive-old");
    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return session.has_selection && !session.loading;
    }));

    state.test_selected_remote();
    ASSERT_TRUE(wait_for([&]() {
        const auto session = state.remote_edit_session_snapshot();
        return !session.testing && session.test_message.find("succeeded") != std::string::npos;
    }));

    pool.shutdown();

    TempHome fail_home;
    FakeProviderServer fail_server;
    fail_server.start();
    fail_server.fail_about();
    fail_server.configure_env(fail_home.path());

    misty::core::WorkerPool fail_pool(1);
    misty::panel::ProvidersState fail_state;
    fail_state.init(fail_pool);

    ASSERT_TRUE(wait_for([&]() {
        return !fail_state.provider_cards_snapshot().empty();
    }));
    fail_state.select_remote("drive-old");
    ASSERT_TRUE(wait_for([&]() {
        const auto session = fail_state.remote_edit_session_snapshot();
        return session.has_selection && !session.loading;
    }));

    fail_state.test_selected_remote();
    ASSERT_TRUE(wait_for([&]() {
        const auto session = fail_state.remote_edit_session_snapshot();
        return !session.testing && session.error_message.find("about failed") != std::string::npos;
    }));

    fail_pool.shutdown();
}
