#pragma once

#include <memory>
#include <string>

#include "panels/panel/multi_panel.h"

namespace misty::panel {

class DockPanel : public MultiPanel {
public:
    DockPanel();
    ~DockPanel() override = default;

    bool open_plugin_panel(const std::string& panel_id);
    void render_launcher();

private:
    TabController::Tab create_default_tab(std::int16_t tab_idx) const override;
    void render_panel_contents() override;
    bool shows_tab_bar(const Pane& pane) const override;

    std::string title_for_panel(const std::string& panel_id) const;
};

} // namespace misty::panel
