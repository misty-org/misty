#include "core/workspaces/workspace.h"

#include <algorithm>
#include <fstream>
#include <limits>
#include <string_view>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"

namespace misty::core {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

constexpr int kWorkspaceSchemaVersion = 1;

WorkspaceTabSnapshot tab_from_json(const json& data) {
    WorkspaceTabSnapshot snapshot;
    if (!data.is_object()) {
        return snapshot;
    }
    snapshot.context_key = data.value("context_key", std::string());
    snapshot.state_key = data.value("state_key", std::string());
    snapshot.title = data.value("title", std::string());
    snapshot.restore_state = data.value("restore_state", std::string());
    snapshot.idx = static_cast<std::int16_t>(data.value("idx", -1));
    return snapshot;
}

json tab_to_json(const WorkspaceTabSnapshot& snapshot) {
    return json{
        {"context_key", snapshot.context_key},
        {"state_key", snapshot.state_key},
        {"title", snapshot.title},
        {"restore_state", snapshot.restore_state},
        {"idx", snapshot.idx},
    };
}

std::vector<WorkspaceTabSnapshot> tabs_from_json(const json& data) {
    std::vector<WorkspaceTabSnapshot> snapshots;
    if (!data.is_array()) {
        return snapshots;
    }
    snapshots.reserve(data.size());
    for (const auto& item : data) {
        snapshots.push_back(tab_from_json(item));
    }
    return snapshots;
}

json tabs_to_json(const std::vector<WorkspaceTabSnapshot>& snapshots) {
    json data = json::array();
    for (const auto& snapshot : snapshots) {
        data.push_back(tab_to_json(snapshot));
    }
    return data;
}

WorkspacePaneSnapshot pane_from_json(const json& data) {
    WorkspacePaneSnapshot snapshot;
    if (!data.is_object()) {
        return snapshot;
    }
    snapshot.pane_id = data.value("pane_id", std::string());
    snapshot.tabs = tabs_from_json(data.value("tabs", json::array()));
    snapshot.closed_tabs = tabs_from_json(data.value("closed_tabs", json::array()));
    snapshot.active_tab_idx = static_cast<std::int16_t>(data.value("active_tab_idx", -1));
    return snapshot;
}

json pane_to_json(const WorkspacePaneSnapshot& snapshot) {
    return json{
        {"pane_id", snapshot.pane_id},
        {"tabs", tabs_to_json(snapshot.tabs)},
        {"closed_tabs", tabs_to_json(snapshot.closed_tabs)},
        {"active_tab_idx", snapshot.active_tab_idx},
    };
}

WorkspaceClosedPaneSnapshot closed_pane_from_json(const json& data) {
    WorkspaceClosedPaneSnapshot snapshot;
    if (!data.is_object()) {
        return snapshot;
    }
    snapshot.pane_id = data.value("pane_id", std::string());
    snapshot.tabs = tabs_from_json(data.value("tabs", json::array()));
    snapshot.closed_tabs = tabs_from_json(data.value("closed_tabs", json::array()));
    snapshot.active_tab_idx = static_cast<std::int16_t>(data.value("active_tab_idx", -1));
    snapshot.restore_mode = data.value("restore_mode", std::string("same_lane"));
    snapshot.lane_index = data.value("lane_index", -1);
    snapshot.row_index = data.value("row_index", -1);
    return snapshot;
}

json closed_pane_to_json(const WorkspaceClosedPaneSnapshot& snapshot) {
    return json{
        {"pane_id", snapshot.pane_id},
        {"tabs", tabs_to_json(snapshot.tabs)},
        {"closed_tabs", tabs_to_json(snapshot.closed_tabs)},
        {"active_tab_idx", snapshot.active_tab_idx},
        {"restore_mode", snapshot.restore_mode},
        {"lane_index", snapshot.lane_index},
        {"row_index", snapshot.row_index},
    };
}

WorkspaceExplorerSnapshot explorer_from_json(const json& data) {
    WorkspaceExplorerSnapshot snapshot;
    if (!data.is_object()) {
        return snapshot;
    }
    snapshot.active_pane_id = data.value("active_pane_id", std::string());
    snapshot.next_tab_idx = static_cast<std::int16_t>(data.value("next_tab_idx", 1));
    snapshot.next_pane_idx = static_cast<std::int16_t>(data.value("next_pane_idx", 1));
    snapshot.grid_split_ratio = data.value("grid_split_ratio", 0.5f);
    snapshot.lane_split_ratios = data.value("lane_split_ratios", std::vector<float>{0.5f, 0.5f});

    snapshot.grid_pane_ids.clear();
    const json grid = data.value("grid_pane_ids", json::array());
    if (grid.is_array()) {
        for (const auto& lane_data : grid) {
            std::vector<std::string> lane;
            if (lane_data.is_array()) {
                for (const auto& pane_id : lane_data) {
                    if (pane_id.is_string()) {
                        lane.push_back(pane_id.get<std::string>());
                    }
                }
            }
            if (!lane.empty()) {
                snapshot.grid_pane_ids.push_back(std::move(lane));
            }
        }
    }

    const json panes = data.value("panes", json::array());
    if (panes.is_array()) {
        snapshot.panes.reserve(panes.size());
        for (const auto& pane_data : panes) {
            snapshot.panes.push_back(pane_from_json(pane_data));
        }
    }

    const json closed_panes = data.value("closed_panes", json::array());
    if (closed_panes.is_array()) {
        snapshot.closed_panes.reserve(closed_panes.size());
        for (const auto& pane_data : closed_panes) {
            snapshot.closed_panes.push_back(closed_pane_from_json(pane_data));
        }
    }

    return snapshot;
}

json explorer_to_json(const WorkspaceExplorerSnapshot& snapshot) {
    json panes = json::array();
    for (const auto& pane : snapshot.panes) {
        panes.push_back(pane_to_json(pane));
    }

    json closed_panes = json::array();
    for (const auto& pane : snapshot.closed_panes) {
        closed_panes.push_back(closed_pane_to_json(pane));
    }

    return json{
        {"active_pane_id", snapshot.active_pane_id},
        {"next_tab_idx", snapshot.next_tab_idx},
        {"next_pane_idx", snapshot.next_pane_idx},
        {"grid_pane_ids", snapshot.grid_pane_ids},
        {"grid_split_ratio", snapshot.grid_split_ratio},
        {"lane_split_ratios", snapshot.lane_split_ratios},
        {"panes", std::move(panes)},
        {"closed_panes", std::move(closed_panes)},
    };
}

WorkspaceFileTabSnapshot file_tab_from_json(const json& data) {
    WorkspaceFileTabSnapshot snapshot;
    if (!data.is_object()) {
        return snapshot;
    }
    snapshot.idx = static_cast<std::int16_t>(data.value("idx", -1));
    snapshot.title = data.value("title", std::string());
    snapshot.explorer = explorer_from_json(data.value("explorer", json::object()));
    return snapshot;
}

json file_tab_to_json(const WorkspaceFileTabSnapshot& snapshot) {
    return json{
        {"idx", snapshot.idx},
        {"title", snapshot.title},
        {"explorer", explorer_to_json(snapshot.explorer)},
    };
}

Workspace workspace_from_json(const json& data) {
    Workspace workspace(data.value("id", std::string()));
    workspace.set_title(data.value("title", std::string()));
    workspace.sidebar_width = data.value("sidebar_width", workspace.sidebar_width);
    workspace.sidebar_visible = data.value("sidebar_visible", workspace.sidebar_visible);
    workspace.inspector_width = data.value("inspector_width", workspace.inspector_width);
    workspace.inspector_visible = data.value("inspector_visible", workspace.inspector_visible);
    workspace.active_tab_idx = static_cast<std::int16_t>(data.value("active_tab_idx", -1));
    workspace.next_tab_idx = static_cast<std::int16_t>(data.value("next_tab_idx", 0));
    const json tabs = data.value("tabs", json::array());
    if (tabs.is_array()) {
        workspace.tabs.reserve(tabs.size());
        for (const auto& tab_data : tabs) {
            WorkspaceFileTabSnapshot tab = file_tab_from_json(tab_data);
            if (tab.idx >= 0) {
                workspace.tabs.push_back(std::move(tab));
            }
        }
    }
    workspace.explorer = explorer_from_json(data.value("explorer", json::object()));
    return workspace;
}

json workspace_to_json(const Workspace& workspace) {
    json tabs = json::array();
    for (const auto& tab : workspace.tabs) {
        if (tab.idx >= 0) {
            tabs.push_back(file_tab_to_json(tab));
        }
    }

    return json{
        {"id", workspace.id()},
        {"title", workspace.title()},
        {"sidebar_width", workspace.sidebar_width},
        {"sidebar_visible", workspace.sidebar_visible},
        {"inspector_width", workspace.inspector_width},
        {"inspector_visible", workspace.inspector_visible},
        {"active_tab_idx", workspace.active_tab_idx},
        {"next_tab_idx", workspace.next_tab_idx},
        {"tabs", std::move(tabs)},
        {"explorer", explorer_to_json(workspace.explorer)},
    };
}

}  // namespace

Workspace::Workspace() = default;

Workspace::Workspace(std::string id)
    : id_(std::move(id)) {}

Workspace::~Workspace() {
    destroy();
}

void Workspace::destroy() {}

void Workspace::load() {
    if (id_.empty()) {
        return;
    }

    const WorkspaceDocument document = load_workspace_document();
    const auto it = std::find_if(document.workspaces.begin(), document.workspaces.end(), [&](const Workspace& workspace) {
        return workspace.id() == id_;
    });
    if (it != document.workspaces.end()) {
        *this = *it;
    }
}

void Workspace::save() {
    if (id_.empty()) {
        return;
    }

    WorkspaceDocument document = load_workspace_document();
    const auto it = std::find_if(document.workspaces.begin(), document.workspaces.end(), [&](const Workspace& workspace) {
        return workspace.id() == id_;
    });
    if (it == document.workspaces.end()) {
        document.workspaces.push_back(*this);
    } else {
        *it = *this;
    }
    if (document.active_workspace_id.empty()) {
        document.active_workspace_id = id_;
    }

    constexpr std::string_view prefix = "workspace_";
    if (id_.rfind(prefix, 0) == 0) {
        try {
            const int idx = std::stoi(id_.substr(prefix.size()));
            if (idx >= 0 && idx < std::numeric_limits<std::int16_t>::max()) {
                document.next_workspace_idx = std::max<std::int16_t>(
                    document.next_workspace_idx,
                    static_cast<std::int16_t>(idx + 1));
            }
        } catch (...) {
        }
    }

    save_workspace_document(document);
}

const std::string& Workspace::id() const {
    return id_;
}

void Workspace::set_id(std::string id) {
    id_ = std::move(id);
}

const std::string& Workspace::title() const {
    return title_;
}

void Workspace::set_title(std::string title) {
    title_ = std::move(title);
}

fs::path workspaces_path() {
    return fs::path(EnvManager::get().get_user_home_dir()) / ".misty" / "config" / "workspaces.json";
}

WorkspaceDocument load_workspace_document() {
    WorkspaceDocument document;
    document.schema_version = kWorkspaceSchemaVersion;

    std::ifstream file(workspaces_path());
    if (!file.is_open()) {
        return document;
    }

    json data = json::parse(file, nullptr, false);
    if (!data.is_object()) {
        return document;
    }

    document.schema_version = data.value("schema_version", kWorkspaceSchemaVersion);
    document.active_workspace_id = data.value("active_workspace_id", std::string());
    document.next_workspace_idx = static_cast<std::int16_t>(data.value("next_workspace_idx", 0));

    const json workspaces = data.value("workspaces", json::array());
    if (workspaces.is_array()) {
        document.workspaces.reserve(workspaces.size());
        for (const auto& workspace_data : workspaces) {
            Workspace workspace = workspace_from_json(workspace_data);
            if (!workspace.id().empty()) {
                document.workspaces.push_back(std::move(workspace));
            }
        }
    }

    return document;
}

bool save_workspace_document(const WorkspaceDocument& document, std::string* error) {
    json workspaces = json::array();
    for (const auto& workspace : document.workspaces) {
        if (!workspace.id().empty()) {
            workspaces.push_back(workspace_to_json(workspace));
        }
    }

    const json data{
        {"schema_version", kWorkspaceSchemaVersion},
        {"active_workspace_id", document.active_workspace_id},
        {"next_workspace_idx", document.next_workspace_idx},
        {"workspaces", std::move(workspaces)},
    };

    const fs::path path = workspaces_path();
    try {
        fs::create_directories(path.parent_path());
        std::ofstream file(path);
        if (!file.is_open()) {
            if (error) {
                *error = "Failed to open ~/.misty/config/workspaces.json for writing.";
            }
            return false;
        }
        file << data.dump(2);
        return true;
    } catch (const std::exception& ex) {
        if (error) {
            *error = ex.what();
        }
        return false;
    }
}

}  // namespace misty::core
