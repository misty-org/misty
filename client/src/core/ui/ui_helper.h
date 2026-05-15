#pragma once

#include "imgui.h"

namespace misty::UI {

ImVec2 clamp_window_pos_to_viewport(const ImVec2& pos,
                                    const ImVec2& size,
                                    const ImGuiViewport& viewport,
                                    float padding = 8.0f);

} // namespace misty::UI
