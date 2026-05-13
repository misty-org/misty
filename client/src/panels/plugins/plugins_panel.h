#pragma once

#include <string>

#include "core/ui/ui_registry.h"
#include "panels/panel.h"
#include "panels/plugins/plugins_components.h"
#include "panels/plugins/plugins_detail.h"

namespace misty::panel {

class PluginsPanel : public Panel {
public:
    explicit PluginsPanel(core::UIRegistry& ui_registry);
    ~PluginsPanel() override = default;

    void render() override;

private:
    float sidebar_max_width(float shell_width) const;
    void shell();
    void sidebar(float sidebar_width);
    void section(const PluginsSectionProps& props);
    void splitter();
    void content();

    bool marketplace_collapsed_ = false;
    bool installed_collapsed_ = false;
    char search_query_[128] = {};
    std::string selected_plugin_id_ = "preview_manager";
};

} // namespace misty::panel
