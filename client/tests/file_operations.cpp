#include <gtest/gtest.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>

#include <nlohmann/json.hpp>

#include "core/cache/listing_cache.h"
#include "core/commands/command_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/asset_manager.h"
#include "core/net/http_client.h"
#include "core/threading/worker_pool.h"
#include "core/ui/ui_layout.h"
#include "panels/activity/download_state.h"
#include "panels/activity/activity_state.h"
#include "panels/activity/upload_state.h"
#include "panels/file_sidebar/file_sidebar_state.h"
#include "panels/file_sidebar/remote_mount_state.h"
#include "panels/notification/notification_state.h"
#include "panels/search/search_panel.h"
#include "panels/services/services_state.h"

#include "panels/file_explorer/file_explorer_panel.h"

namespace fs = std::filesystem;

namespace {

struct TempHome {
    TempHome() {
        const char* current = std::getenv("HOME");
        if (current) {
            old_home_ = current;
        }
        path_ = fs::temp_directory_path() /
                fs::path("misty-client-tests-" +
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
              std::chrono::milliseconds timeout = std::chrono::milliseconds(500)) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (predicate()) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return predicate();
}

struct StubDownloadBehavior {
    bool success = true;
    std::string error;
    std::string local_body = "downloaded";
    size_t progress_bytes = 5;
    size_t total_bytes = 10;
} g_download_behavior;

std::string g_last_navigate_path;
std::string g_last_refresh_path;
struct FolderTransferCall {
    bool called = false;
    std::string source_remote;
    std::string source_path;
    std::string dest_remote;
    std::string dest_path;
} g_folder_transfer;
std::string g_last_delete_url;
struct SearchCall {
    std::string remote;
    std::string query;
    std::string path;
};
std::vector<SearchCall> g_search_calls;
std::unordered_map<std::string, std::string> g_search_responses;
std::string g_search_post_body;
std::string g_search_post_response = R"({"items":[]})";

} // namespace

namespace misty::core {

EnvManager& EnvManager::get() {
    static EnvManager instance;
    return instance;
}

std::string EnvManager::get(const std::string& key, const std::string& default_value) const {
    if (key == "PROXY_SERVICE_URL") {
        return "http://proxy.test";
    }
    return default_value;
}

std::string EnvManager::get(const std::string& key) const {
    if (key == "PROXY_SERVICE_URL") {
        return "http://proxy.test";
    }
    return {};
}

bool EnvManager::has(const std::string&) const {
    return false;
}

void EnvManager::reload() {}
void EnvManager::set_env_file_path(const std::string&) {}
std::string EnvManager::get_user_home_dir() { return std::getenv("HOME") ? std::getenv("HOME") : ""; }
void EnvManager::load_env_file() {}
std::string EnvManager::trim(const std::string& str) const { return str; }
std::string EnvManager::unquote(const std::string& str) const { return str; }

HTTPClient& HTTPClient::get() {
    static HTTPClient client;
    return client;
}

HttpResponse HTTPClient::get(const std::string&, const std::map<std::string, std::string>&) { return {200, "", {}}; }
HttpResponse HTTPClient::get_with_timeouts(const std::string&, long, long, const std::map<std::string, std::string>&) { return {200, "", {}}; }
HttpResponse HTTPClient::post(const std::string& url, const std::string& body, const std::map<std::string, std::string>&) {
    if (url.find("/api/search") != std::string::npos) {
        g_search_post_body = body;
        return {200, g_search_post_response, {}};
    }
    return {200, "", {}};
}
HttpResponse HTTPClient::post_with_timeouts(const std::string& url,
                                            const std::string& body,
                                            long,
                                            long,
                                            const std::map<std::string, std::string>&) {
    if (url.find("/api/search") != std::string::npos) {
        g_search_post_body = body;
        return {200, g_search_post_response, {}};
    }
    return {200, "", {}};
}
HttpResponse HTTPClient::put(const std::string&, const std::string&, const std::map<std::string, std::string>&) { return {200, "", {}}; }
HttpResponse HTTPClient::del(const std::string& url, const std::map<std::string, std::string>&) {
    g_last_delete_url = url;
    return {200, "", {}};
}
UploadResult HTTPClient::chunked_upload(const std::string&, const std::string&, size_t, size_t, UploadProgressCallback, std::atomic<bool>*) { return {}; }
DownloadResult HTTPClient::download_to_file(const std::string&, const std::string&, const std::map<std::string, std::string>&, DownloadProgressCallback) { return {}; }
bool HTTPClient::probe_proxy() { return true; }
std::string build_json_object(const std::map<std::string, std::string>&) { return "{}"; }
std::string url_encode(const std::string& str) { return str; }

bool open_file_in_browser(const std::string&) { return false; }
bool open_path_default(const std::string&) { return false; }
bool open_path_with_application(const std::string&, const std::string&) { return false; }
bool move_path_with_user_approval(const std::filesystem::path&, const std::filesystem::path&) { return false; }
bool delete_path_with_user_approval(const std::filesystem::path&) { return false; }
std::filesystem::path get_executable_path() { return {}; }
bool launch_detached_process(const std::string&, const std::vector<std::string>&, const std::string&) { return false; }
bool launch_detached_process(const std::string&, const std::vector<std::string>&, const std::string&, const std::string&, const std::string&) { return false; }

AssetManager& AssetManager::get() {
    static AssetManager instance;
    return instance;
}

SVGTexture& AssetManager::get_svg_texture(const std::string&, int) {
    static SVGTexture texture{0, 0, 0};
    return texture;
}

SVGTexture& AssetManager::get_svg_texture(const std::string&, int, int) {
    static SVGTexture texture{0, 0, 0};
    return texture;
}

} // namespace misty::core

namespace ImGui {

bool BeginChild(const char*, const ImVec2&, ImGuiChildFlags, ImGuiWindowFlags) { return true; }
void EndChild() {}
ImDrawList* GetWindowDrawList() { return nullptr; }
void PushStyleColor(ImGuiCol, const ImVec4&) {}
void PopStyleColor(int) {}
ImVec2 GetCursorScreenPos() { return ImVec2(); }
ImVec2 GetContentRegionAvail() { return ImVec2(); }
float GetCursorPosY() { return 0.0f; }
void SetCursorPosY(float) {}
void SameLine(float, float) {}
void Dummy(const ImVec2&) {}
void PushID(int) {}
void PopID() {}
void TextUnformatted(const char*, const char*) {}
void TextDisabled(const char*, ...) {}
void TextColored(const ImVec4&, const char*, ...) {}
bool Selectable(const char*, bool, ImGuiSelectableFlags, const ImVec2&) { return false; }
bool IsItemHovered(ImGuiHoveredFlags) { return false; }
bool IsItemActive() { return false; }
bool IsItemDeactivatedAfterEdit() { return false; }
ImVec2 CalcTextSize(const char*, const char*, bool, float) { return ImVec2(); }
void PushTextWrapPos(float) {}
void PopTextWrapPos() {}
void SetKeyboardFocusHere(int) {}
double GetTime() { return 0.0; }
void Spacing() {}

} // namespace ImGui

void ImDrawList::AddRectFilled(const ImVec2&, const ImVec2&, ImU32, float, ImDrawFlags) {}
void ImDrawList::AddImage(ImTextureRef, const ImVec2&, const ImVec2&, const ImVec2&, const ImVec2&, ImU32) {}

namespace misty::UI {

bool div(const char*, const BoxStyle&, const std::function<void()>& content) {
    if (content) content();
    return true;
}

bool row(const char*, const BoxStyle&, const std::function<void()>& content) {
    if (content) content();
    return true;
}

bool column(const char*, const BoxStyle&, const std::function<void()>& content) {
    if (content) content();
    return true;
}

bool grid(const char*, int, const BoxStyle&, const std::function<void()>& content) {
    if (content) content();
    return true;
}

void raw(const std::function<void()>& content) {
    if (content) content();
}

void spacer(float, float) {}
void divider(const DividerProps&) {}
void text(const TextProps&) {}
void image(const ImageProps&) {}
bool button(const char*, const ButtonProps&, const std::function<void()>& content) {
    if (content) content();
    return false;
}
bool image_button(const char*, const ImageButtonProps&) { return false; }
bool input_text(const InputTextProps&) { return false; }
bool select(const SelectProps&) { return false; }

} // namespace misty::UI

namespace misty::core {

CommandManager& CommandManager::get() {
    static CommandManager instance;
    return instance;
}

void CommandManager::load() {}
void CommandManager::clear_runtime_commands() {}
void CommandManager::register_runtime_command(const std::string&, const std::string&) {}
bool CommandManager::matches(const std::string&, bool) const {
    return false;
}
std::string CommandManager::label(const std::string&) const { return {}; }
std::vector<std::pair<std::string, std::string>> CommandManager::list_shortcuts() const { return {}; }
bool CommandManager::save_shortcuts(const std::vector<std::pair<std::string, std::string>>&, std::string*) { return true; }

} // namespace misty::core

namespace misty::panel {

ServicesState::ServicesState() = default;
ServicesState::~ServicesState() = default;
void ServicesState::init(core::WorkerPool&) {}
void ServicesState::refresh_connections() {}
bool ServicesState::has_connections() { return true; }
bool ServicesState::is_remote_connected(const std::string&) { return true; }
void ServicesState::initiate_login(const std::string&, const std::string&) {}
void ServicesState::disconnect_remote(const std::string&) {}
bool ServicesState::get_remote_card_state(const std::string&, RemoteCardState&) { return false; }
std::string ServicesState::get_remote_alias(const std::string&) { return {}; }
bool ServicesState::set_remote_alias(const std::string&, const std::string&) { return false; }
void ServicesState::fetch_files(const std::string&, const std::string&, FilesCallback) {}
void ServicesState::refetch_sync_items(const std::string&, const std::string&, FilesCallback) {}
void ServicesState::watch_sync_dir(const std::string&, const std::string&, FilesCallback) {}
void ServicesState::unwatch_sync_dir(const std::string&, const std::string&, FilesCallback) {}
void ServicesState::run_sync_now(const std::string&, FilesCallback) {}
void ServicesState::fetch_sync_items(const std::string&, const std::string&, FilesCallback) {}
void ServicesState::fetch_sync_items_stream(const std::string&, const std::string&, StreamFilesCallback, FilesCallback) {}
void ServicesState::mark_local_dirty(const std::string&, const std::string&, bool, bool, const std::string&, int64_t, FilesCallback) {}
void ServicesState::mark_local_synced(const std::string&, const std::string&, FilesCallback) {}
void ServicesState::upload_file(const std::string&, const std::string&, const std::string&, core::UploadProgressCallback progress_cb, UploadCallback callback) {
    if (progress_cb) {
        progress_cb(4, 4);
    }
    if (callback) {
        callback(true, "");
    }
}
void ServicesState::transfer_folder(const std::string& source_remote,
                                    const std::string& source_path,
                                    const std::string& dest_remote,
                                    const std::string& dest_path,
                                    FilesCallback callback) {
    g_folder_transfer.called = true;
    g_folder_transfer.source_remote = source_remote;
    g_folder_transfer.source_path = source_path;
    g_folder_transfer.dest_remote = dest_remote;
    g_folder_transfer.dest_path = dest_path;
    if (callback) {
        callback(true, R"({"status":"transferred"})", "");
    }
}
void ServicesState::create_folder(const std::string&, const std::string&, CreateFolderCallback) {}
void ServicesState::search_files(const std::string& remote,
                                 const std::string& query,
                                 const std::string& path,
                                 FilesCallback callback) {
    g_search_calls.push_back({remote, query, path});
    const auto it = g_search_responses.find(remote);
    const std::string body = it == g_search_responses.end() ? R"({"items":[]})" : it->second;
    if (callback) {
        callback(true, body, "");
    }
}
void ServicesState::reconcile_fs_watchers(const std::vector<RemoteWatchInfo>&) {}
void ServicesState::suppress_fs_path(const std::string&) {}
void ServicesState::unsuppress_fs_path(const std::string&) {}
void ServicesState::register_dirty_indicator_callback(const std::string&, DirtyIndicatorCallback) {}
void ServicesState::start_remote_config(const std::string&, const std::string&) {}
void ServicesState::continue_remote_config(const std::string&) {}
void ServicesState::cancel_remote_config() {}
void ServicesState::load_remote_aliases_locked() {}
void ServicesState::save_remote_aliases_locked() const {}
void ServicesState::dispatch_fs_events(const std::string&, const std::string&, std::vector<core::sync::FsEvent>) {}

void ServicesState::download_file(const std::string&,
                                  const std::string&,
                                  const std::string& local_path,
                                  DownloadProgressCallback progress_cb,
                                  DownloadCallback callback) {
    if (progress_cb) {
        progress_cb(g_download_behavior.progress_bytes, g_download_behavior.total_bytes);
    }
    if (g_download_behavior.success) {
        write_file(local_path, g_download_behavior.local_body);
        callback(true, local_path, "");
    } else {
        callback(false, local_path, g_download_behavior.error);
    }
}

void ServicesState::download_folder(const std::string&,
                                    const std::string&,
                                    const std::string& local_path,
                                    DownloadCallback callback) {
    if (g_download_behavior.success) {
        fs::create_directories(local_path);
        write_file(fs::path(local_path) / "stub.txt", g_download_behavior.local_body);
        callback(true, local_path, "");
    } else {
        callback(false, local_path, g_download_behavior.error);
    }
}

FileExplorerPanel::FileExplorerPanel(core::UIRegistry& registry,
                                     core::WorkerPool& worker_pool,
                                     std::shared_ptr<MistyClient> client,
                                     std::string state_key,
                                     std::string search_state_key,
                                     std::string panel_id,
                                     bool,
                                     std::string)
    : registry_(registry),
      worker_pool_(worker_pool),
      client_(std::move(client)),
      state_key_(std::move(state_key)),
      search_state_key_(std::move(search_state_key)),
      window_name_("File Explorer##" + panel_id) {}

FileExplorerPanel::~FileExplorerPanel() = default;

void FileExplorerPanel::render() {}

void FileExplorerPanel::navigate_to_path(const std::string& path, bool, bool) {
    g_last_navigate_path = path;
}

bool FileExplorerPanel::resolve_remote_path_context(const std::string& path,
                                                    std::string& remote_name,
                                                    std::string& remote_path) const {
    remote_name.clear();
    remote_path.clear();

    const auto info = path_utils::parse_remote_path(path);
    if (info.provider_folder.empty() || info.remote_name.empty()) {
        return false;
    }

    remote_name = info.remote_name;
    remote_path = info.relative_path;

    const auto& workspace = registry_.get_state<RemoteMountState>("RemoteMounts");
    for (const auto& mapping : workspace.remote_mappings) {
        if (mapping.provider_folder == info.provider_folder &&
            (mapping.folder_name == info.remote_name || mapping.remote_name == info.remote_name)) {
            remote_name = mapping.remote_name;
            return true;
        }
    }

    return true;
}

bool FileExplorerPanel::resolve_drop_destination_path(const std::string& path,
                                                      std::string& resolved_path,
                                                      std::string* error_message) const {
    resolved_path = path;
    if (!misty::panel::path_utils::is_remote_path(path)) {
        return true;
    }

    const auto info = misty::panel::path_utils::parse_remote_path(path);
    if (info.provider_folder.empty()) {
        if (error_message) {
            *error_message = "Navigate into a provider or remote folder before dropping items.";
        }
        return false;
    }

    if (!info.remote_name.empty()) {
        return true;
    }

    const auto& workspace = registry_.get_state<RemoteMountState>("RemoteMounts");
    const RemoteAccountMapping* unique_mapping = nullptr;
    for (const auto& mapping : workspace.remote_mappings) {
        if (mapping.provider_folder != info.provider_folder) {
            continue;
        }
        if (unique_mapping != nullptr) {
            if (error_message) {
                *error_message = "Provider has multiple accounts. Open it and drop into a specific remote.";
            }
            return false;
        }
        unique_mapping = &mapping;
    }

    if (unique_mapping == nullptr) {
        if (error_message) {
            *error_message = "Provider has no connected remote destination.";
        }
        return false;
    }

    resolved_path = misty::panel::path_utils::get_mount_root() + "/" +
        unique_mapping->provider_folder + "/" + unique_mapping->folder_name;
    return true;
}

void FileExplorerPanel::notify_shared_path_refresh(const std::string& path) {
    g_last_refresh_path = path;
}

} // namespace misty::panel

#include "panels/search/search_panel.cpp"
#include "panels/search/search_impl.cpp"
#include "panels/file_explorer/actions.cpp"

namespace {

class FileExplorerActionsTest : public ::testing::Test {
protected:
    FileExplorerActionsTest()
        : worker_pool_(1),
          panel_(registry_, worker_pool_, nullptr, "Files", "Search", "test", false, "") {}

    void SetUp() override {
        g_last_navigate_path.clear();
        g_last_refresh_path.clear();
        g_last_delete_url.clear();
        g_search_calls.clear();
        g_search_responses.clear();
        g_search_post_body.clear();
        g_search_post_response = R"({"items":[]})";
        g_download_behavior = {};
        g_folder_transfer = {};

        auto& workspace = registry_.get_state<misty::panel::RemoteMountState>("RemoteMounts");
        misty::panel::RemoteAccountMapping mapping;
        mapping.folder_name = "alice";
        mapping.remote_name = "onedrive-alice";
        mapping.remote_type = "onedrive";
        mapping.display_name = "OneDrive";
        mapping.provider_folder = "OneDrive";
        workspace.remote_mappings = {mapping};
    }

    TempHome home_;
    misty::core::UIRegistry registry_;
    misty::core::WorkerPool worker_pool_;
    misty::panel::FileExplorerPanel panel_;
};

TEST(SearchPanelTest, LocalSearchUsesProxyResults) {
    TempHome home;

    misty::core::UIRegistry registry;
    misty::core::WorkerPool worker_pool(1);
    misty::panel::SearchPanel panel(registry, worker_pool, "Files", "Search");

    auto& file_state = registry.get_state<misty::panel::FileExplorerState>("Files");
    std::snprintf(file_state.current_path, sizeof(file_state.current_path), "%s", home.path().c_str());

    g_search_post_body.clear();
    g_search_post_response = nlohmann::json{
        {"items", {
            {
                {"id", "local:" + (home.path() / "Docs" / "report.pdf").string()},
                {"name", "report.pdf"},
                {"path", (home.path() / "Docs" / "report.pdf").string()},
                {"source", "LOCAL"},
                {"is_dir", false},
                {"score", 42},
            },
            {
                {"id", "local:" + (home.path() / "Notes" / "report-notes").string()},
                {"name", "report-notes"},
                {"path", (home.path() / "Notes" / "report-notes").string()},
                {"source", "LOCAL"},
                {"is_dir", true},
                {"score", 30},
            },
        }},
    }.dump();

    panel.submit_search("report", home.path().string());

    auto& search_state = registry.get_state<misty::panel::SearchState>("Search");
    ASSERT_TRUE(wait_for([&]() {
        std::lock_guard<std::mutex> lock(search_state.mu);
        return !search_state.search_in_flight && search_state.results.size() == 2;
    }));

    ASSERT_FALSE(g_search_post_body.empty());
    const auto request = nlohmann::json::parse(g_search_post_body);
    EXPECT_EQ(request.value("query", std::string{}), "report");
    EXPECT_EQ(request.value("path", std::string{}), home.path().string());
    EXPECT_EQ(request.value("source", std::string{}), "LOCAL");
    ASSERT_TRUE(request.contains("depth"));
    EXPECT_EQ(request["depth"].value("scope", std::string{}), "CWD");
    EXPECT_EQ(request["depth"].value("depth", -1), 0);

    std::vector<std::string> names;
    std::vector<bool> is_dir;
    {
        std::lock_guard<std::mutex> lock(search_state.mu);
        for (const auto& result : search_state.results) {
            names.push_back(result.name);
            is_dir.push_back(result.is_dir);
        }
    }

    EXPECT_EQ(names, (std::vector<std::string>{"report.pdf", "report-notes"}));
    EXPECT_EQ(is_dir, (std::vector<bool>{false, true}));
}

TEST_F(FileExplorerActionsTest, LocalPasteLocalToLocalCopiesAndMoves) {
    const fs::path base = home_.path() / "work";
    const fs::path src_dir = base / "src";
    const fs::path dest_dir = base / "dest";
    fs::create_directories(src_dir);
    fs::create_directories(dest_dir);

    const fs::path copy_src = src_dir / "copy.txt";
    const fs::path move_src = src_dir / "move.txt";
    write_file(copy_src, "copy");
    write_file(move_src, "move");

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem copy_item;
    copy_item.path = copy_src.string();
    copy_item.name = copy_src.filename().string();

    misty::panel::UnifiedFileItem move_item = copy_item;
    move_item.path = move_src.string();
    move_item.name = move_src.filename().string();

    panel_.perform_paste_local_to_local(state, copy_item, dest_dir.string(), misty::panel::ClipboardOp::COPY);
    panel_.perform_paste_local_to_local(state, move_item, dest_dir.string(), misty::panel::ClipboardOp::CUT);

    EXPECT_TRUE(fs::exists(copy_src));
    EXPECT_TRUE(fs::exists(dest_dir / "copy.txt"));
    EXPECT_FALSE(fs::exists(move_src));
    EXPECT_TRUE(fs::exists(dest_dir / "move.txt"));
}

TEST_F(FileExplorerActionsTest, PerformDeleteRemovesLocalPath) {
    const fs::path target = home_.path() / "delete-me.txt";
    write_file(target, "bye");

    misty::panel::FileExplorerState state;
    bool requires_permission = false;
    EXPECT_TRUE(panel_.perform_delete(state, target.string(), &requires_permission));
    EXPECT_FALSE(requires_permission);
    EXPECT_FALSE(fs::exists(target));
}

TEST_F(FileExplorerActionsTest, LocalPasteToCloudQueuesUploadWithoutImmediateExplorerRefresh) {
    const fs::path local_file = home_.path() / "local.txt";
    write_file(local_file, "payload");

    const fs::path remote_dir = home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "Docs";
    fs::create_directories(remote_dir);

    auto& state = registry_.get_state<misty::panel::FileExplorerState>("Files");
    std::snprintf(state.current_path, sizeof(state.current_path), "%s", remote_dir.c_str());

    auto& clipboard = registry_.get_state<misty::panel::ClipboardState>("Clipboard");
    clipboard.op = misty::panel::ClipboardOp::COPY;
    misty::panel::UnifiedFileItem item;
    item.name = "local.txt";
    item.path = local_file.string();
    item.id = local_file.string();
    item.source = misty::panel::FileSource::LOCAL;
    clipboard.items = {item};

    panel_.perform_paste(state);

    auto& sidebar = registry_.get_state<misty::panel::FileSidebarState>("FileSidebar");
    ASSERT_EQ(sidebar.upload_queue.size(), 1u);
    EXPECT_TRUE(sidebar.pending_upload_start);
    EXPECT_EQ(sidebar.upload_queue[0].remote_name, "onedrive-alice");
    EXPECT_EQ(sidebar.upload_queue[0].remote_path, "Docs");
    EXPECT_TRUE(g_last_navigate_path.empty());
    EXPECT_TRUE(g_last_refresh_path.empty());
    EXPECT_TRUE(fs::exists(remote_dir / "local.txt"));
}

TEST_F(FileExplorerActionsTest, CloudPasteToLocalUsesDownloadPathForNotSyncedFile) {
    const fs::path dest_dir = home_.path() / "Downloads";
    fs::create_directories(dest_dir);

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem item;
    item.name = "remote.txt";
    item.path = (home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "remote.txt").string();
    item.remote_name = "onedrive-alice";
    item.remote_path = "remote.txt";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::NOT_SYNCED;
    item.size = 10;

    panel_.perform_paste_cloud_to_local(state, item, dest_dir.string(), misty::panel::ClipboardOp::COPY);

    auto& downloads = registry_.get_state<misty::panel::DownloadState>("Downloads");
    const auto items = downloads.get_all_downloads();
    ASSERT_EQ(items.size(), 1u);
    EXPECT_EQ(items[0].status, misty::panel::DownloadStatus::COMPLETED);
    EXPECT_TRUE(fs::exists(dest_dir / "remote.txt"));
    EXPECT_TRUE(g_last_delete_url.empty());
}

TEST_F(FileExplorerActionsTest, CloudCutToLocalDeletesRemoteSourceForNotSyncedFile) {
    const fs::path dest_dir = home_.path() / "Downloads";
    fs::create_directories(dest_dir);

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem item;
    item.name = "remote.txt";
    item.path = (home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "remote.txt").string();
    item.remote_name = "onedrive-alice";
    item.remote_path = "remote.txt";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::NOT_SYNCED;
    item.size = 10;

    panel_.perform_paste_cloud_to_local(state, item, dest_dir.string(), misty::panel::ClipboardOp::CUT);

    EXPECT_TRUE(fs::exists(dest_dir / "remote.txt"));
    EXPECT_NE(g_last_delete_url.find("/api/file?remote=onedrive-alice&path=remote.txt"), std::string::npos);
}

TEST_F(FileExplorerActionsTest, CloudFolderPasteToLocalDownloadsFolderContents) {
    const fs::path dest_dir = home_.path() / "Downloads";
    fs::create_directories(dest_dir);

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem item;
    item.name = "Folder";
    item.path = (home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "Folder").string();
    item.remote_name = "onedrive-alice";
    item.remote_path = "Folder";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::NOT_SYNCED;
    item.is_dir = true;

    panel_.perform_paste_cloud_to_local(state, item, dest_dir.string(), misty::panel::ClipboardOp::COPY);

    ASSERT_TRUE(wait_for([&]() { return fs::exists(dest_dir / "Folder" / "stub.txt"); }));
    EXPECT_TRUE(g_last_delete_url.empty());
    EXPECT_EQ(g_last_refresh_path, dest_dir.string());
}

TEST_F(FileExplorerActionsTest, CloudPasteToCloudStagesDownloadThenQueuesCleanupUpload) {
    const fs::path target_dir = home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "Target";
    fs::create_directories(target_dir);

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem item;
    item.name = "remote.txt";
    item.path = (home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "remote.txt").string();
    item.remote_name = "onedrive-alice";
    item.remote_path = "remote.txt";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::NOT_SYNCED;
    item.size = 10;

    panel_.perform_drop_items(state, {item}, target_dir.string(), misty::panel::ClipboardOp::COPY);

    auto& sidebar = registry_.get_state<misty::panel::FileSidebarState>("FileSidebar");
    ASSERT_EQ(sidebar.upload_queue.size(), 1u);
    EXPECT_EQ(sidebar.upload_queue[0].remote_name, "onedrive-alice");
    EXPECT_EQ(sidebar.upload_queue[0].remote_path, "Target");
    EXPECT_EQ(sidebar.upload_queue[0].file_name, "remote.txt");
    EXPECT_TRUE(sidebar.upload_queue[0].cleanup_after_upload);
    EXPECT_EQ(sidebar.upload_queue[0].cleanup_path, sidebar.upload_queue[0].file_path);
    EXPECT_TRUE(sidebar.pending_upload_start);
    EXPECT_TRUE(fs::exists(sidebar.upload_queue[0].file_path));
    EXPECT_FALSE(fs::exists(target_dir / "remote.txt"));

    auto& downloads = registry_.get_state<misty::panel::DownloadState>("Downloads");
    const auto items = downloads.get_all_downloads();
    ASSERT_EQ(items.size(), 1u);
    EXPECT_EQ(items[0].status, misty::panel::DownloadStatus::COMPLETED);
}

TEST_F(FileExplorerActionsTest, CloudCutToCloudUploadsThenDeletesRemoteSourceForNotSyncedFile) {
    const fs::path target_dir = home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "Target";
    fs::create_directories(target_dir);

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem item;
    item.name = "remote.txt";
    item.path = (home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "remote.txt").string();
    item.remote_name = "onedrive-alice";
    item.remote_path = "remote.txt";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::NOT_SYNCED;
    item.size = 10;

    panel_.perform_drop_items(state, {item}, target_dir.string(), misty::panel::ClipboardOp::CUT);

    auto& sidebar = registry_.get_state<misty::panel::FileSidebarState>("FileSidebar");
    EXPECT_TRUE(sidebar.upload_queue.empty());
    EXPECT_NE(g_last_delete_url.find("/api/file?remote=onedrive-alice&path=remote.txt"), std::string::npos);
}

TEST_F(FileExplorerActionsTest, CloudFolderPasteToCloudUsesProxyFolderTransfer) {
    const fs::path target_dir = home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "Target";
    fs::create_directories(target_dir);

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem item;
    item.name = "Folder";
    item.path = (home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "Folder").string();
    item.remote_name = "onedrive-alice";
    item.remote_path = "Folder";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::NOT_SYNCED;
    item.is_dir = true;

    panel_.perform_drop_items(state, {item}, target_dir.string(), misty::panel::ClipboardOp::COPY);

    EXPECT_TRUE(g_folder_transfer.called);
    EXPECT_EQ(g_folder_transfer.source_remote, "onedrive-alice");
    EXPECT_EQ(g_folder_transfer.source_path, "Folder");
    EXPECT_EQ(g_folder_transfer.dest_remote, "onedrive-alice");
    EXPECT_EQ(g_folder_transfer.dest_path, "Target/Folder");
}

TEST_F(FileExplorerActionsTest, CloudFolderPasteToProviderFolderUsesResolvedRemoteRoot) {
    const fs::path provider_dir = home_.path() / "misty" / "mnt" / "OneDrive";
    fs::create_directories(provider_dir);

    misty::panel::FileExplorerState state;
    misty::panel::UnifiedFileItem item;
    item.name = "Folder";
    item.path = (home_.path() / "misty" / "mnt" / "Google Drive" / "drive" / "Folder").string();
    item.remote_name = "google-drive";
    item.remote_path = "Folder";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::NOT_SYNCED;
    item.is_dir = true;

    panel_.perform_drop_items(state, {item}, provider_dir.string(), misty::panel::ClipboardOp::COPY);

    EXPECT_TRUE(g_folder_transfer.called);
    EXPECT_EQ(g_folder_transfer.source_remote, "google-drive");
    EXPECT_EQ(g_folder_transfer.source_path, "Folder");
    EXPECT_EQ(g_folder_transfer.dest_remote, "onedrive-alice");
    EXPECT_EQ(g_folder_transfer.dest_path, "Folder");
}

TEST_F(FileExplorerActionsTest, CopyPreservesRemoteSourceForMirroredItems) {
    const fs::path remote_file = home_.path() / "misty" / "mnt" / "OneDrive" / "alice" / "Docs" / "remote.txt";
    write_file(remote_file, "payload");

    auto& state = registry_.get_state<misty::panel::FileExplorerState>("Files");
    misty::panel::UnifiedFileItem item;
    item.id = "remote-item";
    item.name = "remote.txt";
    item.path = remote_file.string();
    item.remote_name = "onedrive-alice";
    item.remote_path = "Docs/remote.txt";
    item.source = misty::panel::FileSource::REMOTE;
    item.status = misty::panel::SyncStatus::SYNCED;
    state.files = {item};
    state.selected_files.insert(item.id);

    panel_.perform_copy(state);

    auto& clipboard = registry_.get_state<misty::panel::ClipboardState>("Clipboard");
    ASSERT_EQ(clipboard.items.size(), 1u);
    EXPECT_EQ(clipboard.items[0].source, misty::panel::FileSource::REMOTE);
    EXPECT_EQ(clipboard.items[0].remote_name, "onedrive-alice");
    EXPECT_EQ(clipboard.items[0].remote_path, "Docs/remote.txt");
}

TEST(UploadStateTest, FailedUploadRetainsRetryContext) {
    misty::panel::UploadState uploads;
    const uint64_t id = uploads.start_upload("report.txt", "/tmp/report.txt", "onedrive-alice", 42);
    uploads.set_retry_context(id, "onedrive-alice", "Docs");
    uploads.fail_upload(id, "boom");

    const auto all = uploads.get_all_uploads();
    ASSERT_EQ(all.size(), 1u);
    EXPECT_EQ(all[0].status, misty::panel::UploadStatus::FAILED);
    EXPECT_EQ(all[0].remote_name, "onedrive-alice");
    EXPECT_EQ(all[0].remote_path, "Docs");
    EXPECT_TRUE(all[0].can_retry());
}

TEST(FileSidebarStateTest, CancelFlagStopsQueueAdvancementState) {
    misty::panel::FileSidebarState sidebar;
    sidebar.is_uploading = true;
    sidebar.cancel_upload.store(true);
    misty::panel::FileUploadProgress progress;
    progress.file_name = "a.txt";
    sidebar.upload_queue.push_back(progress);
    sidebar.current_upload_index = 0;

    {
        std::lock_guard<std::mutex> lock(sidebar.upload_mutex);
        sidebar.upload_queue[0].is_complete = true;
        sidebar.current_upload_index++;
    }
    if (sidebar.cancel_upload.load()) {
        sidebar.is_uploading = false;
    }

    EXPECT_FALSE(sidebar.is_uploading);
    EXPECT_EQ(sidebar.current_upload_index, 1u);
}

TEST(ListingCacheTest, RefreshOverwriteReplacesStaleCachedListing) {
    TempHome home;
    const std::string remote = "onedrive-alice";
    const std::string path = "Docs";
    const std::string stale = R"({"items":[{"name":"old.txt"}]})";
    const std::string fresh = R"({"items":[{"name":"new.txt"}]})";

    misty::core::listing_cache::save(remote, path, stale);
    std::string body;
    ASSERT_TRUE(misty::core::listing_cache::load(remote, path, body));
    EXPECT_EQ(body, stale);

    misty::core::listing_cache::save(remote, path, fresh);
    ASSERT_TRUE(misty::core::listing_cache::load(remote, path, body));
    EXPECT_EQ(body, fresh);
}

} // namespace
