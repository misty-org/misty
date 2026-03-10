#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace misty::core {

struct WorkspaceTabSnapshot {
    std::string context_key;
    std::string state_key;
    std::string title;
    std::string restore_state;
    std::int16_t idx = -1;
};

struct WorkspacePaneSnapshot {
    std::string pane_id;
    std::vector<WorkspaceTabSnapshot> tabs;
    std::vector<WorkspaceTabSnapshot> closed_tabs;
    std::int16_t active_tab_idx = -1;
};

struct WorkspaceClosedPaneSnapshot {
    std::string pane_id;
    std::vector<WorkspaceTabSnapshot> tabs;
    std::vector<WorkspaceTabSnapshot> closed_tabs;
    std::int16_t active_tab_idx = -1;
    std::string restore_mode = "same_lane";
    int lane_index = -1;
    int row_index = -1;
};

struct WorkspaceExplorerSnapshot {
    std::string active_pane_id;
    std::int16_t next_tab_idx = 1;
    std::int16_t next_pane_idx = 1;
    std::vector<std::vector<std::string>> grid_pane_ids;
    float grid_split_ratio = 0.5f;
    std::vector<float> lane_split_ratios = {0.5f, 0.5f};
    std::vector<WorkspacePaneSnapshot> panes;
    std::vector<WorkspaceClosedPaneSnapshot> closed_panes;
};

struct WorkspaceFileTabSnapshot {
    std::int16_t idx = -1;
    std::string title;
    WorkspaceExplorerSnapshot explorer;
};

/**
* @brief Represents a file explorer workspace with multipanel and tabs
* Only one workspace can be active in-memory at a time
*/
class Workspace {
public:
    Workspace();
    explicit Workspace(std::string id);
    ~Workspace();

    void load();
    void save();

    const std::string& id() const;
    void set_id(std::string id);
    const std::string& title() const;
    void set_title(std::string title);

    float sidebar_width = 260.0f;
    bool sidebar_visible = true;
    float inspector_width = 300.0f;
    bool inspector_visible = true;
    std::int16_t active_tab_idx = -1;
    std::int16_t next_tab_idx = 0;
    std::vector<WorkspaceFileTabSnapshot> tabs;
    WorkspaceExplorerSnapshot explorer;

private:
    void destroy();

private:
    std::string id_;
    std::string title_;
};

struct WorkspaceDocument {
    int schema_version = 1;
    std::string active_workspace_id;
    std::int16_t next_workspace_idx = 0;
    std::vector<Workspace> workspaces;
};

std::filesystem::path workspaces_path();
WorkspaceDocument load_workspace_document();
bool save_workspace_document(const WorkspaceDocument& document, std::string* error = nullptr);

}  // namespace misty::core
