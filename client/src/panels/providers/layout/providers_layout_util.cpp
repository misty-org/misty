#include "panels/providers/layout/providers_layout_util.h"

#include <algorithm>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kTeal = ImVec4(0.02f, 0.71f, 0.74f, 1.0f);
        constexpr ImVec4 kTealHover = ImVec4(0.06f, 0.77f, 0.80f, 1.0f);
        constexpr ImVec4 kTealActive = ImVec4(0.01f, 0.60f, 0.63f, 1.0f);
    }

    int compute_provider_columns(float available_width, float min_item_width, float spacing) {
        if (available_width <= min_item_width) {
            return 1;
        }
        return std::max(1, static_cast<int>((available_width + spacing) / (min_item_width + spacing)));
    }

    float compute_provider_item_width(float available_width, int columns, float spacing) {
        if (columns <= 1) {
            return available_width;
        }
        return (available_width - spacing * static_cast<float>(columns - 1)) / static_cast<float>(columns);
    }

    float compute_provider_search_width(float content_width) {
        return std::min(420.0f, std::max(220.0f, content_width * 0.42f));
    }

    float compute_provider_right_block_width(float content_width, float button_width) {
        return compute_provider_search_width(content_width) + button_width + 20.0f;
    }

    bool provider_teal_button(const char* label, const ImVec2& size) {
        ImGui::PushStyleColor(ImGuiCol_Button, kTeal);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kTealHover);
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, kTealActive);
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.98f, 0.99f, 1.0f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
        const bool pressed = ImGui::Button(label, size);
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(4);
        return pressed;
    }
}
