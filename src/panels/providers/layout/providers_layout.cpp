#include "panels/providers/providers_panel.h"

#include "core/manager/asset_manager.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/layout/providers_layout_util.h"
#include "imgui.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kPanelBg = ImVec4(0.10f, 0.11f, 0.13f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.945f, 0.933f, 0.910f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.788f, 0.769f, 0.737f, 1.0f);
        constexpr ImVec4 kSearchBg = ImVec4(0.15f, 0.17f, 0.19f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kReadyBg = ImVec4(0.14f, 0.17f, 0.19f, 1.0f);
        constexpr ImVec4 kReadyText = ImVec4(0.42f, 0.86f, 0.55f, 1.0f);
        constexpr float kSectionChromeHeight = 88.0f;

        std::string lowercase_copy(std::string value) {
            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return value;
        }

        bool workflow_matches_query(const ProviderWorkflow& workflow, const std::string& query) {
            if (query.empty()) {
                return true;
            }
            const std::string needle = lowercase_copy(query);
            const std::string haystack = lowercase_copy(workflow.type + " " + workflow.name + " " + workflow.description);
            return haystack.find(needle) != std::string::npos;
        }

        void draw_workflow_logo(const ProviderWorkflow& workflow, float size) {
            ProviderCard card;
            card.provider_id = workflow.type.empty() ? workflow.name : workflow.type;
            card.provider_label = workflow.name;
            draw_provider_logo(card, size);
        }

        void draw_ready_pill(const ProvidersHealthCard& health) {
            const char* label = health.status_value.empty() ? "Unavailable" : health.status_value.c_str();
            const ImVec2 text_size = ImGui::CalcTextSize(label);
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const ImVec2 size(text_size.x + 44.0f, 32.0f);
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const float radius = 16.0f;
            draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(kReadyBg), radius);
            draw_list->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(kBorder), radius);
            const ImU32 dot = health.is_ready ? IM_COL32(79, 216, 119, 255) : IM_COL32(142, 151, 162, 255);
            draw_list->AddCircleFilled(ImVec2(pos.x + 18.0f, pos.y + size.y * 0.5f), 5.0f, dot);
            ImGui::SetCursorScreenPos(ImVec2(pos.x + 32.0f, pos.y + (size.y - text_size.y) * 0.5f));
            ImGui::PushStyleColor(ImGuiCol_Text, health.is_ready ? kReadyText : kMuted);
            ImGui::TextUnformatted(label);
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(ImVec2(pos.x, pos.y));
            ImGui::Dummy(size);
        }
    }

    void ProvidersPanel::render() {
        auto& state = registry_.get_state<ProvidersState>("Providers");
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
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));

        if (ImGui::Begin("ProvidersPanel", nullptr, flags)) {
            const float content_width = ImGui::GetContentRegionAvail().x;
            show_top_bar(state, content_width);
            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            show_status_messages(state);
            show_health_card(state.health_card_snapshot());

            const float remaining_height = ImGui::GetContentRegionAvail().y;
            const float list_height_budget = std::max(0.0f, remaining_height - kSectionChromeHeight);

            show_connected_accounts(state, list_height_budget);
            show_provider_dialogs(state);
        }

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }

    void ProvidersPanel::sync_search_buffer(ProvidersState& state) {
        const std::string query = state.search_query();
        if (std::strncmp(search_buf_, query.c_str(), sizeof(search_buf_)) != 0) {
            std::snprintf(search_buf_, sizeof(search_buf_), "%s", query.c_str());
        }
    }

    void ProvidersPanel::show_status_messages(ProvidersState& state) {
        std::string error_message;
        std::string success_message;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            error_message = state.error_message;
            success_message = state.success_message;
        }

        if (!error_message.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.96f, 0.48f, 0.48f, 1.0f));
            ImGui::TextWrapped("%s", error_message.c_str());
            ImGui::PopStyleColor();
        }
        if (!success_message.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.48f, 0.86f, 0.59f, 1.0f));
            ImGui::TextWrapped("%s", success_message.c_str());
            ImGui::PopStyleColor();
        }
    }

    void ProvidersPanel::show_top_bar(ProvidersState& state, float content_width) {
        const ProvidersHealthCard health = state.health_card_snapshot();

        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::SetWindowFontScale(1.55f);
        ImGui::TextUnformatted("Providers");
        ImGui::SetWindowFontScale(1.0f);
        ImGui::PopStyleColor();

        ImGui::SameLine(0.0f, 18.0f);
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() - 3.0f);
        draw_ready_pill(health);

        const float button_width = 166.0f;
        const float right_gap = 14.0f;
        const float search_width = std::min(compute_provider_search_width(content_width), content_width * 0.36f);
        const float right_block = search_width + button_width + right_gap;
        const float right_start = std::max(ImGui::GetCursorPosX() + 18.0f, content_width - right_block);

        ImGui::SameLine();
        ImGui::SetCursorPosX(right_start);

        ImGui::BeginGroup();
        ImGui::PushStyleColor(ImGuiCol_FrameBg, kSearchBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::PushStyleColor(ImGuiCol_TextDisabled, kMuted);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(42.0f, 12.0f));

        ImGui::SetNextItemWidth(search_width);
        const bool changed = ImGui::InputTextWithHint("##providers_search", "Search providers", search_buf_, sizeof(search_buf_));
        if (changed) {
            state.set_search_query(search_buf_);
        }

        const ImVec2 input_min = ImGui::GetItemRectMin();
        const ImVec2 input_max = ImGui::GetItemRectMax();
        if (changed || ImGui::IsItemActivated() || ImGui::IsItemClicked()) {
            ImGui::OpenPopup("##providers_search_dropdown");
        }
        auto& search_icon = core::AssetManager::get().get_svg_texture("search-16", 18);
        if (search_icon.id != 0) {
            ImGui::GetWindowDrawList()->AddImage(
                search_icon.id,
                ImVec2(input_min.x + 14.0f, input_min.y + (input_max.y - input_min.y - 18.0f) * 0.5f),
                ImVec2(input_min.x + 32.0f, input_min.y + (input_max.y - input_min.y - 18.0f) * 0.5f + 18.0f),
                ImVec2(0.0f, 0.0f),
                ImVec2(1.0f, 1.0f));
        }

        const auto workflows = state.workflows_snapshot();
        std::vector<ProviderWorkflow> filtered_workflows;
        filtered_workflows.reserve(workflows.size());
        for (const auto& workflow : workflows) {
            if (workflow_matches_query(workflow, search_buf_)) {
                filtered_workflows.push_back(workflow);
            }
        }

        ImGui::SetNextWindowPos(ImVec2(input_min.x, input_max.y + 6.0f), ImGuiCond_Appearing);
        ImGui::SetNextWindowSize(ImVec2(search_width, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.13f, 0.15f, 0.17f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        if (ImGui::BeginPopup("##providers_search_dropdown")) {
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted("Connect provider");
            ImGui::PopStyleColor();
            ImGui::Dummy(ImVec2(0.0f, 4.0f));

            if (filtered_workflows.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("No provider workflows match this search.");
                ImGui::PopStyleColor();
            } else {
                const size_t max_visible = std::min<size_t>(filtered_workflows.size(), 6);
                for (size_t index = 0; index < max_visible; ++index) {
                    const ProviderWorkflow& workflow = filtered_workflows[index];
                    ImGui::PushID(workflow.type.c_str());
                    const ImVec2 row_start = ImGui::GetCursorScreenPos();
                    const float row_width = ImGui::GetContentRegionAvail().x;
                    const ImVec2 row_size(row_width, 48.0f);
                    const bool selected = ImGui::InvisibleButton("##workflow_option", row_size);
                    const bool hovered = ImGui::IsItemHovered();
                    ImDrawList* draw_list = ImGui::GetWindowDrawList();
                    if (hovered) {
                        draw_list->AddRectFilled(
                            row_start,
                            ImVec2(row_start.x + row_size.x, row_start.y + row_size.y),
                            ImGui::GetColorU32(ImVec4(0.17f, 0.20f, 0.24f, 1.0f)),
                            6.0f);
                    }

                    ImGui::SetCursorScreenPos(ImVec2(row_start.x + 10.0f, row_start.y + 8.0f));
                    draw_workflow_logo(workflow, 32.0f);
                    ImGui::SetCursorScreenPos(ImVec2(row_start.x + 54.0f, row_start.y + 7.0f));
                    ImGui::PushStyleColor(ImGuiCol_Text, kText);
                    ImGui::TextUnformatted(workflow.name.empty() ? workflow.type.c_str() : workflow.name.c_str());
                    ImGui::PopStyleColor();
                    ImGui::SetCursorScreenPos(ImVec2(row_start.x + 54.0f, row_start.y + 28.0f));
                    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                    ImGui::TextUnformatted(workflow.type.c_str());
                    ImGui::PopStyleColor();

                    if (selected) {
                        state.on_add_provider();
                        state.select_provider_type(workflow.type);
                        ImGui::CloseCurrentPopup();
                    }
                    ImGui::SetCursorScreenPos(ImVec2(row_start.x, row_start.y + row_size.y));
                    ImGui::PopID();
                }
            }
            ImGui::EndPopup();
        }
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(4);

        ImGui::SameLine(0.0f, right_gap);
        if (provider_teal_button("Add Provider", ImVec2(button_width, input_max.y - input_min.y))) {
            state.on_add_provider();
        }
        ImGui::EndGroup();
    }
}
