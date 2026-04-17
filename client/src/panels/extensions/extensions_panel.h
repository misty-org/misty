#pragma once

#include <string>
#include <vector>

#include "core/extensions/extension_manager.h"
#include "core/extensions/plugin_host.h"
#include "core/ui/ui_registry.h"
#include "panels/panel.h"

namespace misty::panel {

class ExtensionsPanel : public Panel {
public:
    explicit ExtensionsPanel(core::UIRegistry& ui_registry);
    ~ExtensionsPanel() override = default;

    void render() override;

private:
    void render_header(std::size_t file_action_count, std::size_t plugin_count);
    void render_file_action_roots(const std::vector<std::string>& roots);
    void render_plugin_roots(const std::vector<std::string>& roots);
    void render_empty_state(const std::vector<std::string>& roots);
    void render_extension_card(const core::InstalledExtension& extension);
    void render_plugin_card(const core::PluginInfo& plugin);

    static std::string join_strings(const std::vector<std::string>& values);

    core::UIRegistry& ui_registry_;
};

} // namespace misty::panel
