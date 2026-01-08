#pragma once
#include "imgui.h"
#include "registry.h"
#include "navbar_state.h"
#include "layer.h"
#include <memory>

namespace minidfs {
    class NavbarPanel : public Layer {
    public:
        NavbarPanel(UIRegistry& registry);
        ~NavbarPanel() override = default;
        void render();

    private:
        UIRegistry& registry_;
        
        void render_nav_item(const char* icon, const char* label, int index, NavbarState& state);
    };
}