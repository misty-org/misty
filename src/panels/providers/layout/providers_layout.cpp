#include "panels/providers/providers_panel.h"

#include "core/manager/asset_manager.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/content/providers_tables.h"
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
        constexpr ImVec4 kPanelBg = ImVec4(0.027f, 0.035f, 0.043f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.945f, 0.933f, 0.910f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.788f, 0.769f, 0.737f, 1.0f);
        constexpr ImVec4 kSearchBg = ImVec4(0.043f, 0.051f, 0.059f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
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
    }

    void ProvidersPanel::render_panel_contents() {
        auto& shared_state = registry_.get_state<ProvidersState>("Providers");
        auto& state = registry_.get_state<ProvidersState>(state_key_);
        state.init(worker_pool_, false);
        state.attach_shared_state(&shared_state);
        state.sync_shared_data_from(shared_state);
        if (!pending_restore_remote_.empty()) {
            state.select_remote(pending_restore_remote_);
            pending_restore_remote_.clear();
        }
        if (state.selected_page_tab() == ProvidersPageTab::Diagnostics &&
            state.rclone_config_session_snapshot().config_path.empty()) {
            state.refresh_rclone_config_paths();
        }
        sync_search_buffer(state);

        const float pane_width = ImGui::GetContentRegionAvail().x;
        const bool compact_pane = pane_width < 760.0f;
        const ImVec2 workspace_padding(
            compact_pane ? 14.0f : 24.0f,
            compact_pane ? 16.0f : 20.0f);

        ImGui::PushStyleColor(ImGuiCol_ChildBg, kPanelBg);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, workspace_padding);
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 8.0f));

        if (ImGui::BeginChild("##providers_workspace", ImVec2(0.0f, 0.0f),
                              ImGuiChildFlags_AlwaysUseWindowPadding,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            const float content_width = ImGui::GetContentRegionAvail().x;
            show_top_bar(state, content_width);
            ImGui::Dummy(ImVec2(0.0f, 6.0f));
            show_status_messages(state);

            const float remaining_height = ImGui::GetContentRegionAvail().y;
            const float list_height_budget = std::max(0.0f, remaining_height);

            render_providers_workspace(registry_, state, list_height_budget);
            show_provider_dialogs(state);
        }

        ImGui::EndChild();
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
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::SetWindowFontScale(1.55f);
        ImGui::TextUnformatted("Providers");
        const float title_right = ImGui::GetItemRectMax().x - ImGui::GetWindowPos().x;
        ImGui::SetWindowFontScale(1.0f);
        ImGui::PopStyleColor();

        const bool compact = content_width < 700.0f;
        const float button_width = compact ? std::min(146.0f, content_width * 0.36f) : 166.0f;
        const float right_gap = 14.0f;
        const float search_width = compact
            ? std::max(120.0f, content_width - button_width - right_gap)
            : std::min(compute_provider_search_width(content_width), content_width * 0.36f);
        const float right_block = search_width + button_width + right_gap;
        const float right_start = std::max(title_right + 24.0f, content_width - right_block);

        if (compact) {
            ImGui::Dummy(ImVec2(0.0f, 4.0f));
        } else {
            ImGui::SameLine();
            ImGui::SetCursorPosX(right_start);
        }

        ImGui::BeginGroup();
        ImGui::PushStyleColor(ImGuiCol_FrameBg, kSearchBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::PushStyleColor(ImGuiCol_TextDisabled, kMuted);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(40.0f, 10.0f));

        ImGui::SetNextItemWidth(search_width);
        const bool changed = ImGui::InputTextWithHint("##providers_search", "Search remotes", search_buf_, sizeof(search_buf_));
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
        ImGui::PushStyleColor(ImGuiCol_PopupBg, kSearchBg);
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
                            ImGui::GetColorU32(ImVec4(0.094f, 0.094f, 0.106f, 1.0f)),
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
        if (provider_teal_button("+  Add Remote", ImVec2(button_width, input_max.y - input_min.y))) {
            state.on_add_provider();
        }
        ImGui::EndGroup();
    }
}
