#pragma once

#include "imgui.h"

namespace misty::panel {
    int compute_provider_columns(float available_width, float min_item_width, float spacing);
    float compute_provider_item_width(float available_width, int columns, float spacing);
    float compute_provider_search_width(float content_width);
    float compute_provider_right_block_width(float content_width, float button_width);
    bool provider_teal_button(const char* label, const ImVec2& size);
}
