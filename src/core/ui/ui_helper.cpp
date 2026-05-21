#include "core/ui/ui_helper.h"

#include <algorithm>

namespace misty::UI {

ImVec2 clamp_window_pos_to_viewport(const ImVec2& pos,
                                    const ImVec2& size,
                                    const ImGuiViewport& viewport,
                                    float padding) {
    const float min_x = viewport.WorkPos.x + padding;
    const float min_y = viewport.WorkPos.y + padding;
    const float max_x = viewport.WorkPos.x + viewport.WorkSize.x - size.x - padding;
    const float max_y = viewport.WorkPos.y + viewport.WorkSize.y - size.y - padding;

    return ImVec2(
        std::clamp(pos.x, min_x, std::max(min_x, max_x)),
        std::clamp(pos.y, min_y, std::max(min_y, max_y))
    );
}

} // namespace misty::UI
