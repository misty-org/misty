#include "core/ui/ui_animate.h"

#include <algorithm>
#include <cmath>

namespace misty::UI {

namespace {
constexpr float kDotLoopSeconds = 1.35f;
constexpr int kDotCount = 3;

float smooth_mix(float t) {
    t = std::clamp(t, 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

void draw_loading_dots(ImDrawList* draw_list, const ImVec2& center, float extent, float time) {
    const float radius = std::clamp(extent * 0.055f, 4.0f, 8.0f);
    const float gap = radius * 3.1f;
    const float start_x = center.x - gap;

    for (int i = 0; i < kDotCount; ++i) {
        const float phase = std::fmod(time / kDotLoopSeconds + static_cast<float>(i) / kDotCount, 1.0f);
        const float wave = smooth_mix(0.5f + 0.5f * std::sin((phase * 2.0f - 0.5f) * 3.14159265f));
        const float scale = 0.76f + wave * 0.34f;
        const int alpha = static_cast<int>(120.0f + wave * 120.0f);
        const ImVec2 dot_center(
            start_x + static_cast<float>(i) * gap,
            center.y - wave * radius * 0.42f);

        draw_list->AddCircleFilled(
            dot_center,
            radius * scale,
            IM_COL32(232, 234, 238, alpha),
            32);
    }
}

} // namespace

float MistyLoadingAnimationLoopSeconds() {
    return kDotLoopSeconds;
}

void DrawMistyLoadingAnimation(
    const ImVec2& min,
    const ImVec2& max,
    float sprite_size,
    ImU32 overlay_color
) {
    ImDrawList* draw_list = ImGui::GetForegroundDrawList(ImGui::GetWindowViewport());
    draw_list->PushClipRect(min, max, true);
    draw_list->AddRectFilled(min, max, overlay_color);

    const float t = static_cast<float>(ImGui::GetTime());
    const float cx = min.x + (max.x - min.x) * 0.5f;
    const float cy = min.y + (max.y - min.y) * 0.5f;
    const float max_extent = std::min(max.x - min.x, max.y - min.y) * 0.35f;
    const float dot_extent = std::min(sprite_size, max_extent);
    const ImVec2 center(cx, cy);

    draw_loading_dots(draw_list, center, dot_extent, t);

    draw_list->PopClipRect();
}

}
