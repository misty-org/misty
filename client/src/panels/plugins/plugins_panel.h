#pragma once

#include "core/ui/ui_registry.h"
#include "panels/panel.h"

namespace misty::panel {

struct PluginsSectionProps {
    const char* id = "";
    const char* label = "";
    bool* collapsed = nullptr;
    const char* placeholder = "Cards coming next.";
};

struct PluginsContentProps {
    const char* title = "Plugins";
    const char* body = "";
};

class PluginsPanel : public Panel {
public:
    explicit PluginsPanel(core::UIRegistry& ui_registry);
    ~PluginsPanel() override = default;

    void render() override;

private:
    float sidebarMaxWidth(float shell_width) const;
    void updateSidebarWidth(float max_sidebar_width);
    void shell();
    void sidebar();
    void section(const PluginsSectionProps& props);
    void splitter();
    void content(const PluginsContentProps& props);

    float sidebar_width_ = 180.0f;
    bool sidebar_resizing_ = false;
    float sidebar_drag_start_width_ = 180.0f;
    float sidebar_drag_start_mouse_x_ = 0.0f;
    bool marketplace_collapsed_ = false;
    bool installed_collapsed_ = false;
    char search_query_[128] = {};
};

} // namespace misty::panel
