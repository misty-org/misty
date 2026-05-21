#pragma once

#include <functional>

#include "imgui.h"

namespace misty::panel {

struct PluginsSectionProps {
    const char* id = "";
    const char* label = "";
    bool* collapsed = nullptr;
    const char* placeholder = "Nothing here yet...";
};

struct PluginsSectionHeaderProps {
    const char* id = "";
    const char* label = "";
    bool collapsed = false;
    float width = 0.0f;
};

struct PluginsContentProps {
    const char* title = "Plugins";
    const char* body = "";
};

struct PluginsIconProps {
    const char* icon_path = "";
    bool apply_theme = false;
    float size = 24.0f;
    ImVec4 tint_color = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
};

struct PluginsCardProps {
    const char* id = "";
    const char* icon_path = "";
    const char* monogram = "";
    const char* title = "";
    const char* author = "";
    const char* description = "";
    bool verified = false;
    bool selected = false;
};

void plugins_page(const PluginsContentProps& props, const std::function<void()>& content);
void plugins_icon(const char* id, const PluginsIconProps& props);
bool plugins_section_header(const PluginsSectionHeaderProps& props);
bool plugins_card(const PluginsCardProps& props);

} // namespace misty::panel
