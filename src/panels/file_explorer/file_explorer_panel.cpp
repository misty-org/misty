#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <nlohmann/json.hpp>

#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/state/remote_mount_state.h"

namespace fs = std::filesystem;
using json = nlohmann::json;

using namespace misty::core;

namespace misty::panel {

namespace {
std::string normalize_path_text(const std::string& path) {
    if (path.empty()) {
        return {};
    }
    const std::string normalized = fs::path(path).lexically_normal().generic_string();
    return normalized.empty() || normalized == "." ? path : normalized;
}

std::string local_parent_directory_text(const std::string& path) {
    if (path.empty()) {
        return {};
    }
    const std::string parent = fs::path(path).parent_path().generic_string();
    if (parent.empty() || parent == ".") {
        return {};
    }
    return normalize_path_text(parent);
}

std::string remote_parent_directory_text(const std::string& path) {
    const std::string parent = local_parent_directory_text(path);
    return parent == "/" ? std::string() : parent;
}

bool local_transfer_matches_directory(const std::string& current_path, const std::string& candidate_path) {
    if (current_path.empty() || candidate_path.empty()) {
        return false;
    }
    return normalize_path_text(current_path) == local_parent_directory_text(candidate_path);
}

bool remote_transfer_matches_directory(const RemoteBrowseTarget& current_target,
                                       const std::string& remote_name,
                                       const std::string& remote_path) {
    if (remote_name.empty() || current_target.remote_name != remote_name || remote_path.empty()) {
        return false;
    }
    return normalize_path_text(current_target.remote_path) == remote_parent_directory_text(remote_path);
}

std::vector<std::string> stack_to_vector(std::stack<std::string> values) {
    std::vector<std::string> ordered;
    ordered.reserve(values.size());
    while (!values.empty()) {
        ordered.push_back(values.top());
        values.pop();
    }
    std::reverse(ordered.begin(), ordered.end());
    return ordered;
}

std::stack<std::string> vector_to_stack(const json& values) {
    std::stack<std::string> out;
    if (!values.is_array()) {
        return out;
    }
    for (const auto& value : values) {
        if (value.is_string()) {
            out.push(value.get<std::string>());
        }
    }
    return out;
}

std::string fallback_local_start_path() {
    if (const char* home = std::getenv("HOME")) {
        return home;
    }
    return fs::current_path().string();
}
}  // namespace

FileExplorerPanel::FileExplorerPanel(StateRegistry& registry,
                                     WorkerPool& worker_pool,
                                     FileExplorerPanelProps props)
    : MultiPanel(props.panel_id),
      registry_(registry),
      worker_pool_(worker_pool),
      state_key_(std::move(props.state_key)),
      compare_owner_state_key_(std::move(props.compare_owner_state_key)),
      preview_panel_(std::make_unique<PreviewPanel>()),
      owns_state_cleanup_(props.owns_state_cleanup),
      mode_(props.mode),
      initial_compare_pair_id_(props.compare_pair_id),
      initial_compare_watch_mode_(props.compare_watch_mode),
      initial_compare_diff_tray_open_(props.compare_diff_tray_open) {
    if (compare_owner_state_key_.empty() && mode_ == FileExplorerPanelMode::CompareSync) {
        compare_owner_state_key_ = state_key_;
    }
    registry_.get_state<FileExplorerState>(state_key_);
    auto& library = registry_.get_state<LibraryState>(kLibraryStateKey);
    registry_.get_state<FileListingsState>(kFileListingsStateKey).get_or_create(state_key_);

    if (props.restore_persistent_state) {
        library.load();
    }

    std::string start_path = fallback_local_start_path();

    if (!props.initial_path_override.empty()) {
        start_path = std::move(props.initial_path_override);
    } else if (props.restore_persistent_state) {
        std::string saved_path;
        {
            std::lock_guard<std::mutex> lock(library.mu);
            saved_path = library.last_opened_path;
        }
        if (!saved_path.empty()) {

            bool is_valid = true;
            if (saved_path.rfind("misty://", 0) != 0) {
                if (!fs::exists(saved_path) || !fs::is_directory(saved_path)) {
                    is_valid = false;
                }
            }

            if (is_valid) {
                start_path = saved_path;
            }
        }
    }

    if (!start_path.empty() && start_path.rfind("misty://", 0) != 0) {
        std::error_code ec;
        fs::create_directories(start_path, ec);
    }

    sidebar_panel_ = std::make_shared<FileSidebarPanel>(registry, worker_pool);
    sidebar_panel_->set_mount_path_provider([]() -> std::string {
        if (const char* home = std::getenv("HOME")) {
            return home;
        }
        return {};
    });
    sidebar_panel_->set_active_explorer_state_key_provider([this]() -> std::string {
        return active_explorer_state_key();
    });
    sidebar_panel_->set_navigation_handler([this](const std::string& path) {
        if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
            active_explorer->navigate_to_path(path, true, false);
            return;
        }
        navigate_to_path(path, true, false);
    });

    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    transfer_listener_id_ = transfers.add_listener([this, alive = transfer_listener_alive_](const core::FileTransferRecord& record) {
        if (!alive->load(std::memory_order_acquire)) {
            return;
        }
        queue_transfer_refresh(record);
    });

    if (!props.defer_initial_navigation && !start_path.empty()) {
        navigate_to_path(start_path, false);
    }
}

void FileExplorerPanel::set_search_palette_state_provider(std::function<bool()> open_provider,
                                                          std::function<std::string()> query_provider,
                                                          std::function<void()> open_handler) {
    search_palette_open_provider_ = std::move(open_provider);
    search_palette_query_provider_ = std::move(query_provider);
    search_palette_open_handler_ = std::move(open_handler);
}

FileExplorerPanel::~FileExplorerPanel() {
    transfer_listener_alive_->store(false, std::memory_order_release);
    if (transfer_listener_id_ != 0 && registry_.has_state("FileMasterTransfers")) {
        registry_.get_state<core::FileTransfer>("FileMasterTransfers").remove_listener(transfer_listener_id_);
        transfer_listener_id_ = 0;
    }

    for (auto& sync : file_sync_objects_) {
        if (sync) {
            sync->sync_stop();
        }
    }
    file_sync_objects_.clear();
    file_sync_roots_.clear();

    if (!registry_.has_state(state_key_)) {
        return;
    }

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    auto& library = registry_.get_state<LibraryState>(kLibraryStateKey);
    {
        std::unique_lock<std::recursive_mutex> state_lock(state.mu, std::try_to_lock);
        if (!state_lock.owns_lock()) {
            return;
        }
        std::unique_lock<std::mutex> library_lock(library.mu, std::try_to_lock);
        if (!library_lock.owns_lock()) {
            return;
        }
        if (state.current_path[0] != '\0' && library.last_opened_path != state.current_path) {
            library.last_opened_path = state.current_path;
            library.dirty = true;
        }
    }

    if (library.dirty.load(std::memory_order_relaxed)) {
        library.save_best_effort();
    }
}

std::string FileExplorerPanel::save_restore_state() const {
    const auto& state = const_cast<core::StateRegistry&>(registry_).get_state<FileExplorerState>(state_key_);
    json data;
    data["current_path"] = std::string(state.current_path);
    data["show_hidden"] = ui_.show_hidden;
    data["grid_view"] = ui_.grid_view;
    data["back_history"] = stack_to_vector(state.back_history);
    data["forward_history"] = stack_to_vector(state.forward_history);
    return data.dump();
}

void FileExplorerPanel::restore_workspace_snapshot(const core::WorkspaceExplorerSnapshot& snapshot) {
    suppress_child_initial_navigation_ = true;
    MultiPanel::restore_workspace_snapshot(snapshot);
    suppress_child_initial_navigation_ = false;
}

void FileExplorerPanel::load_restore_state(const std::string& encoded_state) {
    if (encoded_state.empty()) {
        return;
    }

    json data = json::parse(encoded_state, nullptr, false);
    if (data.is_discarded()) {
        return;
    }

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    auto& listing = registry_.get_state<FileListingsState>(kFileListingsStateKey).get_or_create(state_key_);
    const std::string current_path = data.value("current_path", std::string());
    {
        std::lock_guard<std::recursive_mutex> lock(state.mu);
        ui_.clear_transient();
        state.selected_files.clear();
        listing.clear();
        ui_.show_hidden = data.value("show_hidden", ui_.show_hidden);
        ui_.grid_view = data.value("grid_view", ui_.grid_view);
        state.back_history = vector_to_stack(data.value("back_history", json::array()));
        state.forward_history = vector_to_stack(data.value("forward_history", json::array()));
        std::strncpy(state.current_path, current_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        std::strncpy(state.search_path, current_path.c_str(), sizeof(state.search_path) - 1);
        state.search_path[sizeof(state.search_path) - 1] = '\0';
    }
    if (!current_path.empty()) {
        navigate_to_path(current_path, false);
    }
}

void FileExplorerPanel::release_state() {
    if (!owns_state_cleanup_) {
        return;
    }
    if (!registry_.has_state(state_key_)) {
        return;
    }
    {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        std::lock_guard<std::recursive_mutex> lock(state.mu);
        state.clear_state();
    }
    registry_.get_state<FileListingsState>(kFileListingsStateKey).erase(state_key_);
    registry_.erase_state(state_key_);
}

void FileExplorerPanel::render_sidebar() {
    sidebar_panel_->render();
}

void FileExplorerPanel::set_workspace_controls(
    std::function<std::vector<FileSidebarPanel::WorkspaceEntry>()> entries_provider,
    std::function<void(std::int16_t)> select_handler,
    std::function<void(std::string)> create_handler,
    std::function<void(std::int16_t, std::string)> rename_handler,
    std::function<void(std::int16_t)> delete_handler) {
    sidebar_panel_->set_workspace_entries_provider(std::move(entries_provider));
    sidebar_panel_->set_workspace_select_handler(std::move(select_handler));
    sidebar_panel_->set_workspace_create_handler(std::move(create_handler));
    sidebar_panel_->set_workspace_rename_handler(std::move(rename_handler));
    sidebar_panel_->set_workspace_delete_handler(std::move(delete_handler));
}

bool FileExplorerPanel::workspace_dropdown_open() const {
    return sidebar_panel_ && sidebar_panel_->workspace_dropdown_open();
}

void FileExplorerPanel::render_content() {
    render();
}

void FileExplorerPanel::queue_transfer_refresh(const core::FileTransferRecord& record) {
    if (record.status != core::FileTransferStatus::Completed || !registry_.has_state(state_key_)) {
        return;
    }
    if (!transfer_touches_current_listing(record)) {
        return;
    }

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    state.pending_transfer_refresh_epoch.fetch_add(1, std::memory_order_relaxed);
}

bool FileExplorerPanel::transfer_touches_current_listing(const core::FileTransferRecord& record) const {
    if (!registry_.has_state(state_key_)) {
        return false;
    }

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    std::lock_guard<std::recursive_mutex> lock(state.mu);
    const std::string current_path = state.current_path;
    if (current_path.empty()) {
        return false;
    }

    if (auto remote_target = remote_browse_target_for(current_path); remote_target.has_value()) {
        return remote_transfer_matches_directory(*remote_target, record.remote_source_name, record.remote_source_path) ||
               remote_transfer_matches_directory(*remote_target, record.remote_dest_name, record.remote_dest_path);
    }

    return local_transfer_matches_directory(current_path, record.local_source_path) ||
           local_transfer_matches_directory(current_path, record.local_dest_path);
}

}  // namespace misty::panel
