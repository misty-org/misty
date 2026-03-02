#include "core/ui/ui_animate.h"

#include <algorithm>
#include <cmath>
#include <utility>

#include "core/manager/asset_manager.h"

namespace misty::UI {

namespace {

std::pair<ImVec2, ImVec2> frame_uv(int frame, int cols, int rows) {
    const int col = frame % cols;
    const int row = frame / cols;
    const float uv_w = 1.0f / static_cast<float>(cols);
    const float uv_h = 1.0f / static_cast<float>(rows);
    return {
        ImVec2(col * uv_w, row * uv_h),
        ImVec2((col + 1) * uv_w, (row + 1) * uv_h),
    };
}

float smooth_mix(float t) {
    t = std::clamp(t, 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

} // namespace

void DrawMistyLoadingAnimation(
    const ImVec2& min,
    const ImVec2& max,
    float sprite_size,
    ImU32 overlay_color
) {
    static constexpr int COLS = 8;
    static constexpr int ROWS = 2;
    static constexpr int TOTAL = COLS * ROWS;
    static constexpr float FRAME_RATE = 10.0f;
    static constexpr float BOB_RATE = 2.1f;
    static constexpr float BOB_DISTANCE = 4.0f;

    auto& sprite = misty::core::AssetManager::get().get_image_texture("assets/animations/misty_sprite.png");
    ImDrawList* draw_list = ImGui::GetForegroundDrawList(ImGui::GetWindowViewport());
    draw_list->PushClipRect(min, max, true);
    draw_list->AddRectFilled(min, max, overlay_color);

    const float frame_time = static_cast<float>(ImGui::GetTime()) * FRAME_RATE;
    const int frame = static_cast<int>(std::floor(frame_time)) % TOTAL;
    const int next_frame = (frame + 1) % TOTAL;
    const float mix = smooth_mix(frame_time - std::floor(frame_time));
    const auto [uv0, uv1] = frame_uv(frame, COLS, ROWS);
    const auto [next_uv0, next_uv1] = frame_uv(next_frame, COLS, ROWS);

    float t = static_cast<float>(ImGui::GetTime());
    float bob = std::sin(t * BOB_RATE) * BOB_DISTANCE;

    float cx = min.x + (max.x - min.x) * 0.5f;
    float cy = min.y + (max.y - min.y) * 0.5f + bob;
    const float max_sprite_size = std::min(max.x - min.x, max.y - min.y) * 0.35f;
    const float sprite_extent = std::min(sprite_size, max_sprite_size);
    float half = sprite_extent * 0.5f;

    draw_list->AddImage(
        (ImTextureID)(intptr_t)sprite.id,
        ImVec2(cx - half, cy - half),
        ImVec2(cx + half, cy + half),
        uv0,
        uv1,
        IM_COL32(255, 255, 255, static_cast<int>((1.0f - mix) * 255.0f))
    );

    if (mix > 0.0f) {
        draw_list->AddImage(
            (ImTextureID)(intptr_t)sprite.id,
            ImVec2(cx - half, cy - half),
            ImVec2(cx + half, cy + half),
            next_uv0,
            next_uv1,
            IM_COL32(255, 255, 255, static_cast<int>(mix * 255.0f))
        );
    }

    draw_list->PopClipRect();
}

}
