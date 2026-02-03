#pragma once
#include "core/ui_registry.h"
#include "navbar_state.h"
#include "panels/panel.h"
#include "panels/profile/profile_panel.h"
#include "core/svg_loader.h"


namespace misty::panel {
    class NavbarPanel : public Panel {
    public:
        NavbarPanel(UIRegistry& ui_registry);
        ~NavbarPanel() override = default;
        void render() override;


    private:
        void show_nav_item(const char* icon, const char* label, 
            int size, view::ViewID view_id, NavbarState& state);
            
        void show_logo_icon();
        void show_profile_button();

    private:
		float nav_width_ = 77.0f;
        UIRegistry& ui_registry_;
        SVGTexture folder_icon_;
        ProfilePanel profile_panel_;
    };
}