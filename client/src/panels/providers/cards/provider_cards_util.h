#pragma once

#include <string>

#include "imgui.h"
#include "panels/providers/state/providers_state.h"

namespace misty::panel {
    std::string provider_logo_path(const ProviderCard& card);
    void draw_provider_logo(const ProviderCard& card, float size);
    void draw_provider_status_badge(const ProviderCard& card);
    bool provider_outline_button(const char* label, const ImVec2& size);
    void draw_provider_health_status_icon(bool ready);
}
