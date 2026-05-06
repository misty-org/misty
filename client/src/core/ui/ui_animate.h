#pragma once

#include "imgui.h"

namespace misty::UI {

void DrawMistyLoadingAnimation(
    const ImVec2& min,
    const ImVec2& max,
    float sprite_size = 128.0f,
    ImU32 overlay_color = IM_COL32(15, 15, 18, 160)
);

}
