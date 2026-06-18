#include "panels/providers/layout/providers_layout_util.h"

#include <algorithm>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kAccent = ImVec4(0.153f, 0.416f, 0.859f, 1.0f);
        constexpr ImVec4 kAccentHover = ImVec4(0.196f, 0.498f, 0.945f, 1.0f);
        constexpr ImVec4 kAccentActive = ImVec4(0.110f, 0.318f, 0.690f, 1.0f);
        constexpr ImVec4 kAccentText = ImVec4(0.945f, 0.965f, 1.0f, 1.0f);
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
        ImGui::PushStyleColor(ImGuiCol_Button, kAccent);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kAccentHover);
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, kAccentActive);
        ImGui::PushStyleColor(ImGuiCol_Text, kAccentText);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
        const bool pressed = ImGui::Button(label, size);
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(4);
        return pressed;
    }
}
