#pragma once

#include <string>
#include <vector>

#include "core/ui/ui_registry.h"
#include "panels/panel/panel.h"
#include "panels/plugins/plugins_components.h"
#include "panels/plugins/plugins_detail.h"

namespace misty::panel {

class PluginsPanel : public Panel {
public:
    explicit PluginsPanel(core::UIRegistry& ui_registry);
    ~PluginsPanel() override = default;

    void render() override;

private:
    struct PluginListEntry {
        PluginsDetailProps detail;
        std::string logo_path;
    };

    float sidebar_max_width(float shell_width) const;
    void refresh_plugins();
    void ensure_selected_plugin();
    void shell();
    void sidebar(float sidebar_width);
    void section(const PluginsSectionProps& props);
    void cards(const char* id, bool installed_only);
    void segmented_filter();
    void splitter();
    void content();

    bool marketplace_collapsed_ = false;
    bool installed_collapsed_ = false;
    bool installed_filter_ = false;
    char search_query_[128] = {};
    std::string selected_plugin_id_ = "preview_manager";
    std::vector<PluginListEntry> plugins_;
};

} // namespace misty::panel
