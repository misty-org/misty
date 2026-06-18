#include "panels/providers/providers_panel.h"

#include "core/manager/asset_manager.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/dialogs/onedrive_dialogs.h"
#include "panels/providers/dialogs/provider_dialogs_util.h"
#include "panels/providers/layout/providers_layout_util.h"
#include "imgui.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <string>
#include <vector>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kPanelBg = ImVec4(0.08f, 0.11f, 0.14f, 1.0f);
        constexpr ImVec4 kCardBg = ImVec4(0.06f, 0.09f, 0.11f, 1.0f);
        constexpr ImVec4 kCardBgAlt = ImVec4(0.08f, 0.12f, 0.15f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kBorderSoft = ImVec4(0.18f, 0.23f, 0.28f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.945f, 0.933f, 0.910f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.788f, 0.769f, 0.737f, 1.0f);
        constexpr ImVec4 kError = ImVec4(0.95f, 0.49f, 0.49f, 1.0f);
        constexpr ImVec4 kSuccess = ImVec4(0.33f, 0.82f, 0.47f, 1.0f);
        constexpr ImVec4 kAccent = ImVec4(0.18f, 0.54f, 0.95f, 1.0f);
        constexpr float kProviderModalWidth = 1180.0f;
        constexpr float kProviderModalHeight = 780.0f;
        constexpr float kProviderModalFooterHeight = 96.0f;

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

        ProviderCard provider_card_for_workflow(const ProviderWorkflow& workflow) {
            ProviderCard card;
            card.provider_id = workflow.type.empty() ? workflow.name : workflow.type;
            card.provider_label = workflow.name.empty() ? workflow.type : workflow.name;
            card.account_label = workflow.description;
            return card;
        }

        std::string selected_provider_label(
            const std::vector<ProviderWorkflow>& workflows,
            const std::string& provider_type
        ) {
            if (const ProviderWorkflow* workflow = selected_provider_workflow(workflows, provider_type)) {
                return workflow->name.empty() ? workflow->type : workflow->name;
            }
            return provider_type.empty() ? "Select a provider" : provider_type;
        }

        int active_dialog_step(const ActiveProviderConfigSession& session) {
            if (session.current_option.has_value()) {
                return 2;
            }
            if (session.completed || session.current_step_kind == "browser_auth" || session.poll_in_flight) {
                return 3;
            }
            if (session.ui_step >= 2 || session.current_option.has_value() ||
                session.reconnect_mode || session.repair_mode) {
                return 2;
            }
            return 1;
        }

        void draw_step_circle(int number, bool active, bool complete) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const float radius = 15.0f;
            const ImVec2 center(pos.x + radius, pos.y + radius);
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const ImU32 border = ImGui::GetColorU32(complete ? ImVec4(0.18f, 0.52f, 0.30f, 1.0f) : (active ? kAccent : kBorder));
            const ImU32 fill = ImGui::GetColorU32(complete ? ImVec4(0.07f, 0.18f, 0.12f, 1.0f) : (active ? ImVec4(0.09f, 0.19f, 0.30f, 1.0f) : ImVec4(0.08f, 0.11f, 0.14f, 1.0f)));
            draw_list->AddCircleFilled(center, radius, fill, 32);
            draw_list->AddCircle(center, radius, border, 32, active ? 2.0f : 1.4f);
            if (complete) {
                draw_list->AddLine(
                    ImVec2(center.x - 7.0f, center.y),
                    ImVec2(center.x - 2.0f, center.y + 5.0f),
                    ImGui::GetColorU32(kSuccess),
                    2.4f);
                draw_list->AddLine(
                    ImVec2(center.x - 2.0f, center.y + 5.0f),
                    ImVec2(center.x + 8.0f, center.y - 7.0f),
                    ImGui::GetColorU32(kSuccess),
                    2.4f);
            } else {
                char text[8];
                std::snprintf(text, sizeof(text), "%d", number);
                const ImVec2 text_size = ImGui::CalcTextSize(text);
                draw_list->AddText(
                    ImVec2(center.x - text_size.x * 0.5f, center.y - text_size.y * 0.5f),
                    ImGui::GetColorU32(active ? kText : kMuted),
                    text);
            }
            ImGui::Dummy(ImVec2(radius * 2.0f, radius * 2.0f));
        }

        void draw_stepper(int active_step) {
            struct StepDef {
                int number;
                const char* label;
            };
            const StepDef steps[] = {{1, "Provider"}, {2, "Configure"}, {3, "Finish"}};

            ImGui::BeginGroup();
            for (int index = 0; index < 3; ++index) {
                const bool active = steps[index].number == active_step;
                const bool complete = steps[index].number < active_step;
                draw_step_circle(steps[index].number, active, complete);
                ImGui::SameLine(0.0f, 12.0f);
                ImGui::PushStyleColor(ImGuiCol_Text, active || complete ? kText : kMuted);
                ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 5.0f);
                ImGui::TextUnformatted(steps[index].label);
                ImGui::PopStyleColor();

                if (index < 2) {
                    ImGui::SameLine(0.0f, 22.0f);
                    const ImVec2 line_start = ImGui::GetCursorScreenPos();
                    ImGui::GetWindowDrawList()->AddLine(
                        ImVec2(line_start.x, line_start.y + 15.0f),
                        ImVec2(line_start.x + 82.0f, line_start.y + 15.0f),
                        ImGui::GetColorU32(kBorder),
                        1.0f);
                    ImGui::Dummy(ImVec2(82.0f, 30.0f));
                    ImGui::SameLine(0.0f, 22.0f);
                }
            }
            ImGui::EndGroup();
        }

        void draw_search_input(char* buffer, size_t buffer_size, float width) {
            ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.05f, 0.07f, 0.09f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.07f, 0.10f, 0.13f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.07f, 0.10f, 0.13f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(42.0f, 12.0f));
            ImGui::SetNextItemWidth(width);
            ImGui::InputTextWithHint("##provider_search", "Search providers", buffer, buffer_size);
            const ImVec2 input_min = ImGui::GetItemRectMin();
            auto& search_icon = core::AssetManager::get().get_svg_texture("search-16", 18);
            if (search_icon.id != 0) {
                ImGui::GetWindowDrawList()->AddImage(
                    search_icon.id,
                    ImVec2(input_min.x + 14.0f, input_min.y + 12.0f),
                    ImVec2(input_min.x + 32.0f, input_min.y + 30.0f),
                    ImVec2(0.0f, 0.0f),
                    ImVec2(1.0f, 1.0f),
                    ImGui::GetColorU32(kMuted));
            }
            ImGui::PopStyleVar(3);
            ImGui::PopStyleColor(4);
        }

        bool draw_provider_workflow_row(
            const ProviderWorkflow& workflow,
            bool selected,
            bool disabled,
            float width
        ) {
            const float row_height = 98.0f;
            const ImVec2 start = ImGui::GetCursorScreenPos();
            if (disabled) {
                ImGui::BeginDisabled();
            }
            const bool pressed = ImGui::InvisibleButton(("##workflow_" + workflow.type).c_str(), ImVec2(width, row_height));
            if (disabled) {
                ImGui::EndDisabled();
            }

            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const bool hovered = ImGui::IsItemHovered();
            const ImVec4 bg = selected ? ImVec4(0.08f, 0.13f, 0.18f, 1.0f)
                                       : (hovered ? ImVec4(0.08f, 0.11f, 0.14f, 1.0f) : kCardBg);
            draw_list->AddRectFilled(start, ImVec2(start.x + width, start.y + row_height), ImGui::GetColorU32(bg), 8.0f);
            draw_list->AddRect(
                start,
                ImVec2(start.x + width, start.y + row_height),
                ImGui::GetColorU32(selected ? kAccent : kBorderSoft),
                8.0f,
                0,
                selected ? 1.8f : 1.0f);
            if (selected) {
                draw_list->AddRectFilled(start, ImVec2(start.x + 4.0f, start.y + row_height), ImGui::GetColorU32(kAccent), 2.0f);
            }

            ImGui::SetCursorScreenPos(ImVec2(start.x + 28.0f, start.y + 26.0f));
            draw_provider_logo(provider_card_for_workflow(workflow), 44.0f);

            ImGui::SetCursorScreenPos(ImVec2(start.x + 108.0f, start.y + 28.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.08f);
            ImGui::TextUnformatted(workflow.name.empty() ? workflow.type.c_str() : workflow.name.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::SetCursorScreenPos(ImVec2(start.x + 108.0f, start.y + 58.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted(workflow.description.empty() ? "OAuth browser sign-in" : workflow.description.c_str());
            ImGui::PopStyleColor();

            const ImVec2 radio_center(start.x + width - 42.0f, start.y + row_height * 0.5f);
            draw_list->AddCircle(radio_center, 13.0f, ImGui::GetColorU32(selected ? kAccent : kBorder), 32, 1.4f);
            if (selected) {
                draw_list->AddCircleFilled(radio_center, 7.0f, ImGui::GetColorU32(kAccent), 32);
            }

            ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + row_height));
            ImGui::Dummy(ImVec2(width, 14.0f));
            return pressed && !disabled;
        }

        void draw_permission_row() {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddRect(pos, ImVec2(pos.x + 36.0f, pos.y + 36.0f), ImGui::GetColorU32(kBorderSoft), 8.0f);
            auto& lock_icon = core::AssetManager::get().get_svg_texture("lock-24", 20);
            if (lock_icon.id != 0) {
                draw_list->AddImage(
                    lock_icon.id,
                    ImVec2(pos.x + 8.0f, pos.y + 8.0f),
                    ImVec2(pos.x + 28.0f, pos.y + 28.0f),
                    ImVec2(0.0f, 0.0f),
                    ImVec2(1.0f, 1.0f),
                    ImGui::GetColorU32(kMuted));
            }
            ImGui::SetCursorScreenPos(ImVec2(pos.x + 52.0f, pos.y + 9.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::TextUnformatted("Read and write files");
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(ImVec2(pos.x, pos.y + 36.0f));
            ImGui::Dummy(ImVec2(1.0f, 10.0f));
        }

        void draw_next_step(int number, const char* label, bool active) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            draw_step_circle(number, active, number < 1);
            ImGui::SameLine(0.0f, 14.0f);
            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 6.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, active ? kText : kMuted);
            ImGui::TextUnformatted(label);
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(ImVec2(pos.x, pos.y + 30.0f));
            ImGui::Dummy(ImVec2(1.0f, 20.0f));
        }

        void draw_large_success_icon(float size) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const float radius = size * 0.5f;
            const ImVec2 center(pos.x + radius, pos.y + radius);
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddCircleFilled(center, radius, ImGui::GetColorU32(ImVec4(0.06f, 0.17f, 0.11f, 1.0f)), 64);
            draw_list->AddCircle(center, radius - 1.0f, ImGui::GetColorU32(kSuccess), 64, 2.0f);
            draw_list->AddLine(ImVec2(center.x - 18.0f, center.y + 1.0f), ImVec2(center.x - 5.0f, center.y + 14.0f), ImGui::GetColorU32(kSuccess), 4.0f);
            draw_list->AddLine(ImVec2(center.x - 5.0f, center.y + 14.0f), ImVec2(center.x + 24.0f, center.y - 22.0f), ImGui::GetColorU32(kSuccess), 4.0f);
            ImGui::Dummy(ImVec2(size, size));
        }

        void draw_status_pill(const char* label) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const ImVec2 text_size = ImGui::CalcTextSize(label);
            const ImVec2 size(text_size.x + 40.0f, 32.0f);
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(ImVec4(0.07f, 0.20f, 0.13f, 1.0f)), 6.0f);
            draw_list->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(ImVec4(0.12f, 0.32f, 0.20f, 1.0f)), 6.0f);
            draw_list->AddCircleFilled(ImVec2(pos.x + 16.0f, pos.y + 16.0f), 5.0f, ImGui::GetColorU32(kSuccess), 16);
            draw_list->AddText(ImVec2(pos.x + 30.0f, pos.y + 7.0f), ImGui::GetColorU32(kSuccess), label);
            ImGui::Dummy(size);
        }

        void draw_detail_row(const char* label, const std::string& value, bool status = false) {
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted(label);
            ImGui::PopStyleColor();
            ImGui::SameLine(220.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            if (status) {
                ImGui::TextUnformatted("  Running");
                const ImVec2 text_min = ImGui::GetItemRectMin();
                ImGui::GetWindowDrawList()->AddCircleFilled(ImVec2(text_min.x + 5.0f, text_min.y + 9.0f), 5.0f, ImGui::GetColorU32(kSuccess), 16);
            } else {
                ImGui::TextUnformatted(value.c_str());
            }
            ImGui::PopStyleColor();
        }

        void draw_configure_body(
            ProvidersState& state,
            const std::vector<ProviderWorkflow>& workflows,
            const ActiveProviderConfigSession& session,
            bool awaiting_browser,
            bool busy,
            bool locked_existing_provider,
            bool configuring_provider
        ) {
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted("Provider");
            ImGui::PopStyleColor();
            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.12f);
            const std::string provider_label = selected_provider_label(workflows, session.selected_provider_type);
            ImGui::TextUnformatted(provider_label.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 24.0f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 22.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::TextUnformatted("Remote Name");
            ImGui::PopStyleColor();

            std::array<char, 256> remote_name{};
            std::snprintf(remote_name.data(), remote_name.size(), "%s", session.remote_name.c_str());
            if (awaiting_browser || busy || locked_existing_provider) {
                ImGui::BeginDisabled();
            }
            ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.05f, 0.07f, 0.09f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.07f, 0.10f, 0.13f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.07f, 0.10f, 0.13f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
            ImGui::SetNextItemWidth(-1.0f);
            if (ImGui::InputText("##provider_remote_name", remote_name.data(), remote_name.size())) {
                state.set_remote_name(remote_name.data());
            }
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor(4);
            if (awaiting_browser || busy || locked_existing_provider) {
                ImGui::EndDisabled();
            }
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextWrapped("Used as the rclone remote name. You can rename this later.");
            ImGui::PopStyleColor();

            const ProviderWorkflow* workflow = selected_provider_workflow(workflows, session.selected_provider_type);
            const std::vector<ProviderOption> fallback_options =
                (!workflow || workflow->options.empty()) && is_onedrive_provider_type(session.selected_provider_type)
                    ? onedrive_visible_drive_repair_options(session)
                    : std::vector<ProviderOption>{};
            const std::vector<ProviderOption>& provider_options =
                workflow && !workflow->options.empty() ? workflow->options : fallback_options;
            if (!provider_options.empty() && !awaiting_browser && !configuring_provider) {
                ImGui::Dummy(ImVec2(0.0f, 20.0f));
                ImGui::Separator();
                ImGui::Dummy(ImVec2(0.0f, 20.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::TextUnformatted("Provider Settings");
                ImGui::PopStyleColor();
                ImGui::Dummy(ImVec2(0.0f, 8.0f));
                if (busy) {
                    ImGui::BeginDisabled();
                }
                for (const auto& option : provider_options) {
                    render_provider_option_editor(state, option, session);
                    ImGui::Dummy(ImVec2(0.0f, 12.0f));
                }
                if (busy) {
                    ImGui::EndDisabled();
                }
            }

            if (configuring_provider && session.current_option.has_value()) {
                ImGui::Dummy(ImVec2(0.0f, 20.0f));
                ImGui::Separator();
                ImGui::Dummy(ImVec2(0.0f, 20.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::TextUnformatted("Provider Settings");
                ImGui::PopStyleColor();
                if (!session.instructions.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                    ImGui::TextWrapped("%s", session.instructions.c_str());
                    ImGui::PopStyleColor();
                }
                render_provider_option_editor(state, *session.current_option, session);
            }

            if (awaiting_browser) {
                ImGui::Dummy(ImVec2(0.0f, 20.0f));
                ImGui::Separator();
                ImGui::Dummy(ImVec2(0.0f, 20.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::TextUnformatted("Browser Sign-In");
                ImGui::PopStyleColor();
                const std::string status = session.status_message.empty()
                    ? "Waiting for browser sign-in to finish..."
                    : session.status_message;
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", status.c_str());
                ImGui::PopStyleColor();
                if (!session.authorize_url.empty()) {
                    ImGui::Dummy(ImVec2(0.0f, 12.0f));
                    if (provider_outline_button("Open Browser Again", ImVec2(220.0f, 36.0f))) {
                        state.reopen_browser_auth();
                    }
                }
            }
        }

        void draw_finish_body(
            ProvidersState& state,
            const std::vector<ProviderWorkflow>& workflows,
            const ActiveProviderConfigSession& session,
            float width
        ) {
            const std::string provider_label = selected_provider_label(workflows, session.selected_provider_type);
            const std::string remote_label = session.remote_name.empty() ? session.selected_provider_type : session.remote_name;
            const std::string account_label = remote_label;

            const ImVec2 start = ImGui::GetCursorScreenPos();
            draw_large_success_icon(78.0f);
            ImGui::SetCursorScreenPos(ImVec2(start.x + 112.0f, start.y + 4.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.28f);
            ImGui::Text("%s connected", provider_label.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(ImVec2(start.x + 112.0f, start.y + 38.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::Text("%s is ready to use.", remote_label.c_str());
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(ImVec2(start.x + 112.0f, start.y + 70.0f));
            draw_status_pill("Connected");

            ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + 118.0f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 18.0f));
            draw_detail_row("Provider", provider_label);
            ImGui::Dummy(ImVec2(0.0f, 10.0f));
            draw_detail_row("Remote", remote_label);
            ImGui::Dummy(ImVec2(0.0f, 10.0f));
            draw_detail_row("Account", account_label);
            ImGui::Dummy(ImVec2(0.0f, 10.0f));
            draw_detail_row("rclone status", "", true);
            ImGui::Dummy(ImVec2(0.0f, 10.0f));
            draw_detail_row("Last check", "just now");
            ImGui::Dummy(ImVec2(0.0f, 20.0f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 18.0f));
            provider_outline_button("Open Provider", ImVec2(168.0f, 38.0f));
            ImGui::SameLine(0.0f, 16.0f);
            provider_outline_button("Test Sync", ImVec2(138.0f, 38.0f));

            ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + 398.0f));
            if (ImGui::BeginChild("##auth_failure_help", ImVec2(width, 150.0f), true, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::TextUnformatted("If authorization fails");
                ImGui::PopStyleColor();
                ImGui::Dummy(ImVec2(0.0f, 14.0f));
                const ImVec2 fail_pos = ImGui::GetCursorScreenPos();
                ImDrawList* draw_list = ImGui::GetWindowDrawList();
                draw_list->AddRect(fail_pos, ImVec2(fail_pos.x + ImGui::GetContentRegionAvail().x, fail_pos.y + 78.0f), ImGui::GetColorU32(ImVec4(0.64f, 0.22f, 0.13f, 1.0f)), 8.0f);
                draw_list->AddCircle(ImVec2(fail_pos.x + 38.0f, fail_pos.y + 39.0f), 21.0f, ImGui::GetColorU32(ImVec4(1.0f, 0.39f, 0.25f, 1.0f)), 32, 2.5f);
                draw_list->AddText(ImVec2(fail_pos.x + 34.0f, fail_pos.y + 27.0f), ImGui::GetColorU32(ImVec4(1.0f, 0.39f, 0.25f, 1.0f)), "!");
                ImGui::SetCursorScreenPos(ImVec2(fail_pos.x + 82.0f, fail_pos.y + 21.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::TextUnformatted("Connection failed");
                ImGui::PopStyleColor();
                ImGui::SetCursorScreenPos(ImVec2(fail_pos.x + 82.0f, fail_pos.y + 48.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextUnformatted("Browser authorization was cancelled.");
                ImGui::PopStyleColor();
                ImGui::SetCursorScreenPos(ImVec2(fail_pos.x + width - 292.0f, fail_pos.y + 22.0f));
                if (provider_outline_button("Try Again", ImVec2(120.0f, 36.0f))) {
                    state.submit_add_provider();
                }
                ImGui::SameLine(0.0f, 16.0f);
                if (provider_outline_button("Copy Error", ImVec2(132.0f, 36.0f))) {
                    ImGui::SetClipboardText(session.inline_error.empty() ? "Browser authorization was cancelled." : session.inline_error.c_str());
                }
                ImGui::Dummy(ImVec2(width, 86.0f));
            }
            ImGui::EndChild();
        }

        void draw_connection_summary(
            const std::vector<ProviderWorkflow>& workflows,
            const ActiveProviderConfigSession& session
        ) {
            const ProviderWorkflow* workflow = selected_provider_workflow(workflows, session.selected_provider_type);
            const std::string provider_label = selected_provider_label(workflows, session.selected_provider_type);
            const std::string remote_label = session.remote_name.empty() ? session.selected_provider_type : session.remote_name;

            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.08f);
            ImGui::TextUnformatted("Connection Summary");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 30.0f));
            const ImVec2 logo_pos = ImGui::GetCursorScreenPos();
            if (workflow) {
                draw_provider_logo(provider_card_for_workflow(*workflow), 50.0f);
            } else {
                ImGui::Dummy(ImVec2(50.0f, 50.0f));
            }
            ImGui::SetCursorScreenPos(ImVec2(logo_pos.x + 72.0f, logo_pos.y + 5.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted(provider_label.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(ImVec2(logo_pos.x + 72.0f, logo_pos.y + 36.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted(workflow && !workflow->description.empty() ? workflow->description.c_str() : "OAuth browser sign-in");
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(ImVec2(logo_pos.x, logo_pos.y + 84.0f));

            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 22.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted("Permissions");
            ImGui::PopStyleColor();
            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            draw_permission_row();

            ImGui::Dummy(ImVec2(0.0f, 14.0f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 22.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted("Remote path");
            ImGui::PopStyleColor();
            ImGui::Dummy(ImVec2(0.0f, 16.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::Text("%s:", remote_label.c_str());
            ImGui::PopStyleColor();

            if (session.completed) {
                ImGui::Dummy(ImVec2(0.0f, 34.0f));
                if (ImGui::BeginChild("##saved_to_rclone", ImVec2(0.0f, 100.0f), true, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
                    ImGui::PushStyleColor(ImGuiCol_Text, kSuccess);
                    ImGui::SetWindowFontScale(1.08f);
                    ImGui::TextUnformatted("Saved to rclone config");
                    ImGui::SetWindowFontScale(1.0f);
                    ImGui::PopStyleColor();
                    ImGui::Dummy(ImVec2(0.0f, 8.0f));
                    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                    ImGui::TextWrapped("Your changes are written to the rclone configuration file.");
                    ImGui::PopStyleColor();
                }
                ImGui::EndChild();
            }
        }

        void draw_provider_details(
            const std::vector<ProviderWorkflow>& workflows,
            const ActiveProviderConfigSession& session,
            int active_step
        ) {
            const ProviderWorkflow* workflow = selected_provider_workflow(workflows, session.selected_provider_type);
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.08f);
            ImGui::TextUnformatted("Provider Details");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 28.0f));
            if (workflow) {
                const ImVec2 logo_pos = ImGui::GetCursorScreenPos();
                draw_provider_logo(provider_card_for_workflow(*workflow), 58.0f);
                ImGui::SetCursorScreenPos(ImVec2(logo_pos.x + 82.0f, logo_pos.y + 8.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::SetWindowFontScale(1.15f);
                ImGui::TextUnformatted(workflow->name.empty() ? workflow->type.c_str() : workflow->name.c_str());
                ImGui::SetWindowFontScale(1.0f);
                ImGui::PopStyleColor();
                ImGui::SetCursorScreenPos(ImVec2(logo_pos.x + 82.0f, logo_pos.y + 40.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextUnformatted(workflow->description.empty() ? "OAuth browser sign-in" : workflow->description.c_str());
                ImGui::PopStyleColor();
                ImGui::SetCursorScreenPos(ImVec2(logo_pos.x, logo_pos.y + 86.0f));
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("Choose a provider to see connection details.");
                ImGui::PopStyleColor();
                ImGui::Dummy(ImVec2(0.0f, 52.0f));
            }

            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 22.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted("Permissions");
            ImGui::PopStyleColor();
            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            draw_permission_row();

            ImGui::Dummy(ImVec2(0.0f, 14.0f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 22.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted("What happens next");
            ImGui::PopStyleColor();
            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            draw_next_step(1, "Name the remote", active_step == 2);
            draw_next_step(2, "Open browser sign-in", active_step == 3);
            draw_next_step(3, "Authorize file access", false);
        }
    }

    void ProvidersPanel::show_provider_dialogs(ProvidersState& state) {
        const auto session = state.add_provider_session_snapshot();
        const auto workflows = state.workflows_snapshot();

        if (session.show_modal) {
            const char* popup_name = "##providers_add_provider";
            if (!ImGui::IsPopupOpen(popup_name)) {
                ImGui::OpenPopup(popup_name);
            }

            const ProviderDialogText dialog_text = provider_dialog_text(session);
            const bool locked_existing_provider = session.reconnect_mode || session.repair_mode;
            const bool busy = session.submit_in_flight || session.poll_in_flight;
            const bool awaiting_browser = session.current_step_kind == "browser_auth" && !session.current_option.has_value();
            const bool configuring_provider = session.current_option.has_value() && !awaiting_browser;
            const int active_step = active_dialog_step(session);

            ImGuiViewport* viewport = ImGui::GetMainViewport();
            const float modal_width = std::min(kProviderModalWidth, viewport->WorkSize.x - 48.0f);
            const float modal_height = std::min(kProviderModalHeight, viewport->WorkSize.y - 48.0f);
            ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::SetNextWindowSize(ImVec2(modal_width, modal_height), ImGuiCond_Always);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(36.0f, 34.0f));
            ImGui::PushStyleColor(ImGuiCol_PopupBg, kPanelBg);
            ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

            if (ImGui::BeginPopupModal(popup_name, nullptr,
                                       ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                           ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar)) {
                ImGui::BeginGroup();
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::SetWindowFontScale(1.45f);
                ImGui::TextUnformatted(dialog_text.title.c_str());
                ImGui::SetWindowFontScale(1.0f);
                ImGui::PopStyleColor();

                ImGui::Dummy(ImVec2(0.0f, 6.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                if (session.completed) {
                    const std::string provider_label = selected_provider_label(workflows, session.selected_provider_type);
                    ImGui::Text("%s authorization complete.", provider_label.c_str());
                } else {
                    ImGui::TextUnformatted(active_step == 1
                        ? "Choose the cloud provider you want to connect."
                        : dialog_text.intro.c_str());
                }
                ImGui::PopStyleColor();
                ImGui::EndGroup();

                const float stepper_width = 520.0f;
                ImGui::SameLine(modal_width - stepper_width - 42.0f);
                ImGui::SetCursorPosY(54.0f);
                draw_stepper(active_step);

                ImGui::Dummy(ImVec2(0.0f, 30.0f));
                const float content_height = ImGui::GetContentRegionAvail().y - kProviderModalFooterHeight;
                const float left_width = (modal_width - 108.0f) * 0.64f;
                const float right_width = (modal_width - 108.0f) - left_width - 24.0f;

                ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
                ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
                ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBgAlt);
                ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
                if (ImGui::BeginChild("##provider_picker_panel", ImVec2(left_width, content_height), true,
                                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
                    if (!session.completed) {
                        ImGui::PushStyleColor(ImGuiCol_Text, kText);
                        ImGui::SetWindowFontScale(1.12f);
                        ImGui::TextUnformatted(active_step == 1 ? "Choose Provider" : "Configure Provider");
                        ImGui::SetWindowFontScale(1.0f);
                        ImGui::PopStyleColor();
                        ImGui::SameLine(left_width - 132.0f);
                        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                        ImGui::Text("%zu available", workflows.size());
                        ImGui::PopStyleColor();

                        ImGui::Dummy(ImVec2(0.0f, 18.0f));
                    }
                    static char provider_search[128] = {0};
                    if (!session.completed && active_step == 1 && !locked_existing_provider) {
                        draw_search_input(provider_search, sizeof(provider_search), ImGui::GetContentRegionAvail().x);
                        ImGui::Dummy(ImVec2(0.0f, 20.0f));
                    }

                    if (session.completed) {
                        draw_finish_body(state, workflows, session, ImGui::GetContentRegionAvail().x);
                    } else if (workflows.empty()) {
                        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                        ImGui::TextWrapped("Loading provider workflows from the local proxy...");
                        ImGui::PopStyleColor();
                    } else if (active_step == 1 && !locked_existing_provider) {
                        std::vector<ProviderWorkflow> filtered_workflows;
                        filtered_workflows.reserve(workflows.size());
                        for (const auto& workflow : workflows) {
                            if (workflow_matches_query(workflow, provider_search)) {
                                filtered_workflows.push_back(workflow);
                            }
                        }
                        if (filtered_workflows.empty()) {
                            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                            ImGui::TextWrapped("No provider workflows match this search.");
                            ImGui::PopStyleColor();
                        } else {
                            for (const auto& workflow : filtered_workflows) {
                                const bool selected = workflow.type == session.selected_provider_type;
                                if (draw_provider_workflow_row(workflow, selected, false, ImGui::GetContentRegionAvail().x)) {
                                    state.select_provider_type(workflow.type);
                                }
                            }
                        }
                    } else {
                        draw_configure_body(
                            state,
                            workflows,
                            session,
                            awaiting_browser,
                            busy,
                            locked_existing_provider,
                            configuring_provider);
                    }

                    if (!session.inline_error.empty()) {
                        ImGui::Dummy(ImVec2(0.0f, 12.0f));
                        ImGui::PushStyleColor(ImGuiCol_Text, kError);
                        ImGui::TextWrapped("%s", session.inline_error.c_str());
                        ImGui::PopStyleColor();
                    }
                }
                ImGui::EndChild();
                ImGui::SameLine(0.0f, 24.0f);
                if (ImGui::BeginChild("##provider_details_panel", ImVec2(right_width, content_height), true,
                                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
                    if (active_step == 1 && !session.completed) {
                        draw_provider_details(workflows, session, active_step);
                    } else {
                        draw_connection_summary(workflows, session);
                    }
                }
                ImGui::EndChild();
                ImGui::PopStyleColor(2);
                ImGui::PopStyleVar(2);

                const ImVec2 footer_pos = ImGui::GetCursorScreenPos();
                ImGui::GetWindowDrawList()->AddLine(
                    ImVec2(footer_pos.x - 36.0f, footer_pos.y + 24.0f),
                    ImVec2(footer_pos.x + modal_width - 72.0f, footer_pos.y + 24.0f),
                    ImGui::GetColorU32(kBorder));
                ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 48.0f);

                const float continue_width = locked_existing_provider ? 214.0f : 158.0f;
                const float cancel_width = 132.0f;
                ImGui::SetCursorPosX(modal_width - continue_width - cancel_width - 72.0f);
                if (!session.completed) {
                    if (provider_outline_button(awaiting_browser ? "Close" : "Cancel", ImVec2(cancel_width, 44.0f))) {
                        state.dismiss_active_dialog();
                        ImGui::CloseCurrentPopup();
                    }
                    ImGui::SameLine(0.0f, 16.0f);
                } else {
                    if (provider_outline_button("Back", ImVec2(cancel_width, 44.0f))) {
                        state.back_to_configure_add_provider_dialog();
                    }
                    ImGui::SameLine(0.0f, 16.0f);
                }

                const bool primary_disabled = session.submit_in_flight;
                if (primary_disabled) {
                    ImGui::BeginDisabled();
                }
                const char* primary_label = session.completed
                    ? "Done"
                    : (locked_existing_provider ? dialog_text.primary_button_label.c_str() : "Continue");
                if (provider_teal_button(primary_label, ImVec2(continue_width, 44.0f))) {
                    if (session.completed) {
                        state.dismiss_active_dialog();
                        ImGui::CloseCurrentPopup();
                    } else if (active_step == 1 && !locked_existing_provider) {
                        state.continue_add_provider_dialog();
                    } else {
                        state.submit_add_provider();
                    }
                }
                if (primary_disabled) {
                    ImGui::EndDisabled();
                }

                ImGui::EndPopup();
            }

            ImGui::PopStyleColor(2);
            ImGui::PopStyleVar(2);
        }

        bool show_disconnect = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            show_disconnect = state.show_disconnect_modal;
        }
        show_provider_rename_popup(state);
        show_provider_details_popup(state);
        show_provider_disconnect_popup(state, show_disconnect);
        show_onedrive_drive_repair_dialog(state);
    }
}
