#include "core/ui/ui_animate.h"

#include <cmath>

#include "core/manager/asset_manager.h"

namespace misty::UI {

void DrawMistyLoadingAnimation(
    const ImVec2& min,
    const ImVec2& max,
    float sprite_size,
    ImU32 overlay_color
) {
    static constexpr int COLS = 10;
    static constexpr int ROWS = 5;
    static constexpr int TOTAL = COLS * ROWS;
    static constexpr float FRAME_RATE = 20.0f;

    auto& sprite = misty::core::AssetManager::get().get_image_texture("assets/animations/misty_sprite.png");
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(min, max, overlay_color);

    int frame = static_cast<int>(ImGui::GetTime() * FRAME_RATE) % TOTAL;
    int col = frame % COLS;
    int row = frame / COLS;

    float uv_w = 1.0f / COLS;
    float uv_h = 1.0f / ROWS;
    ImVec2 uv0(col * uv_w, row * uv_h);
    ImVec2 uv1((col + 1) * uv_w, (row + 1) * uv_h);

    float t = static_cast<float>(ImGui::GetTime());
    float bob = std::sin(t * 3.0f) * 6.0f;

    float cx = min.x + (max.x - min.x) * 0.5f;
    float cy = min.y + (max.y - min.y) * 0.5f + bob;
    float half = sprite_size * 0.5f;

    draw_list->AddImage(
        (ImTextureID)(intptr_t)sprite.id,
        ImVec2(cx - half, cy - half),
        ImVec2(cx + half, cy + half),
        uv0,
        uv1
    );
}

}
