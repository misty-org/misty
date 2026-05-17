#include "panels/services/services_panel.h"

#include "core/manager/asset_manager.h"
#include "imgui.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kPanelBg = ImVec4(0.10f, 0.11f, 0.13f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
        constexpr ImVec4 kSearchBg = ImVec4(0.15f, 0.17f, 0.19f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kTeal = ImVec4(0.02f, 0.71f, 0.74f, 1.0f);
        constexpr ImVec4 kTealHover = ImVec4(0.06f, 0.77f, 0.80f, 1.0f);
        constexpr ImVec4 kTealActive = ImVec4(0.01f, 0.60f, 0.63f, 1.0f);

        int compute_columns(float available_width, float min_item_width, float spacing) {
            if (available_width <= min_item_width) {
                return 1;
            }
            return std::max(1, static_cast<int>((available_width + spacing) / (min_item_width + spacing)));
        }

        float compute_item_width(float available_width, int columns, float spacing) {
            if (columns <= 1) {
                return available_width;
            }
            return (available_width - spacing * static_cast<float>(columns - 1)) / static_cast<float>(columns);
        }

        bool teal_button(const char* label, const ImVec2& size) {
            ImGui::PushStyleColor(ImGuiCol_Button, kTeal);
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kTealHover);
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, kTealActive);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.98f, 0.99f, 1.0f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
            bool pressed = ImGui::Button(label, size);
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(4);
            return pressed;
        }
    }

    void ServicesPanel::render() {
        auto& state = registry_.get_state<ServicesState>("Services");
        sync_search_buffer(state);

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::PushStyleColor(ImGuiCol_WindowBg, kPanelBg);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(32.0f, 28.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 18.0f));

        if (ImGui::Begin("ServicesPanel", nullptr, flags)) {
            const float content_width = ImGui::GetContentRegionAvail().x;
            show_top_bar(state, content_width);
            ImGui::Separator();
            show_health_card(state.health_card_snapshot());
            show_connected_services(state);
            show_placeholder_dialogs(state);
        }

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }

    void ServicesPanel::sync_search_buffer(ServicesState& state) {
        const std::string& query = state.search_query();
        if (std::strncmp(search_buf_, query.c_str(), sizeof(search_buf_)) != 0) {
            std::snprintf(search_buf_, sizeof(search_buf_), "%s", query.c_str());
        }
    }

    void ServicesPanel::show_top_bar(ServicesState& state, float content_width) {
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::SetWindowFontScale(1.55f);
        ImGui::TextUnformatted("Services");
        ImGui::SetWindowFontScale(1.0f);
        ImGui::PopStyleColor();

        const float button_width = 150.0f;
        const float search_width = std::min(420.0f, std::max(220.0f, content_width * 0.42f));
        const float right_block = search_width + button_width + 20.0f;

        ImGui::SameLine();
        ImGui::Dummy(ImVec2(std::max(0.0f, content_width - right_block), 0.0f));
        ImGui::SameLine();

        ImGui::BeginGroup();
        ImGui::PushStyleColor(ImGuiCol_FrameBg, kSearchBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::PushStyleColor(ImGuiCol_TextDisabled, kMuted);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(42.0f, 12.0f));

        ImGui::SetNextItemWidth(search_width);
        if (ImGui::InputTextWithHint("##services_search", "Search connected services...", search_buf_, sizeof(search_buf_))) {
            state.set_search_query(search_buf_);
        }

        const ImVec2 input_min = ImGui::GetItemRectMin();
        const ImVec2 input_max = ImGui::GetItemRectMax();
        auto& search_icon = core::AssetManager::get().get_svg_texture("search-16", 18);
        if (search_icon.id != 0) {
            ImGui::GetWindowDrawList()->AddImage(
                search_icon.id,
                ImVec2(input_min.x + 14.0f, input_min.y + (input_max.y - input_min.y - 18.0f) * 0.5f),
                ImVec2(input_min.x + 32.0f, input_min.y + (input_max.y - input_min.y - 18.0f) * 0.5f + 18.0f),
                ImVec2(0.0f, 0.0f),
                ImVec2(1.0f, 1.0f));
        }

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(4);

        ImGui::SameLine(0.0f, 16.0f);
        if (teal_button("Add Service", ImVec2(button_width, input_max.y - input_min.y))) {
            state.on_add_service();
        }
        ImGui::EndGroup();
    }

    void ServicesPanel::show_connected_services(ServicesState& state) {
        const auto all_cards = state.service_cards_snapshot();
        const auto filtered_cards = state.filtered_service_cards();
        const bool has_query = !state.search_query().empty();

        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::SetWindowFontScale(1.25f);
        ImGui::TextUnformatted("Connected Services");
        ImGui::SetWindowFontScale(1.0f);
        ImGui::PopStyleColor();

        if (filtered_cards.empty()) {
            show_empty_state(has_query && !all_cards.empty());
            return;
        }

        const float available_width = ImGui::GetContentRegionAvail().x;
        const int columns = compute_columns(available_width, kMinCardWidth, kCardSpacing);
        const float card_width = compute_item_width(available_width, columns, kCardSpacing);

        for (size_t index = 0; index < filtered_cards.size(); ++index) {
            if (index > 0 && (index % static_cast<size_t>(columns)) != 0) {
                ImGui::SameLine(0.0f, kCardSpacing);
            }
            show_service_card(state, filtered_cards[index], card_width);
        }
    }
}
