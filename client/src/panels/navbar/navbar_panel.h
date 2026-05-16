#pragma once
#include "core/ui/ui_registry.h"
#include "navbar_state.h"
#include "panels/panel/panel.h"
#include "panels/activity/activity_panel.h"
#include "core/ui/svg_loader.h"


namespace misty::panel {
    class NavbarPanel : public Panel {
    public:
        NavbarPanel(UIRegistry& ui_registry);
        ~NavbarPanel() override = default;
        void render() override;


    private:
        void content(NavbarState& state);
        void footer(NavbarState& state);
        void nav_item(const char* icon, const char* label,
            int size, view::ViewID view_id, NavbarState& state);

        void logo_icon();
        void activity_button();

    private:
		float nav_width_ = 77.0f;
        UIRegistry& ui_registry_;
        ActivityPanel activity_panel_;
    };
}
