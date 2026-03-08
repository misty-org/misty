#include "panels/providers/providers_panel.h"

#include "panels/providers/cards/provider_cards_util.h"
#include "core/manager/asset_manager.h"
#include "imgui.h"

#include <algorithm>
#include <cstdio>
#include <string>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kCardBg = ImVec4(0.16f, 0.18f, 0.20f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
        constexpr ImVec4 kAccent = ImVec4(0.48f, 0.86f, 0.59f, 1.0f);
        constexpr float kConnectedRowHeight = 72.0f;
        constexpr float kThinScrollbarSize = 8.0f;

        std::string strip_metric_label(const std::string& label, const std::string& value) {
            const std::string prefix = std::string(label) + " ";
            if (value.rfind(prefix, 0) == 0) {
                return value.substr(prefix.size());
            }
            return value;
        }

        void draw_vertical_divider(float height) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            ImGui::GetWindowDrawList()->AddLine(
                ImVec2(pos.x, pos.y + 2.0f),
                ImVec2(pos.x, pos.y + height - 2.0f),
                ImGui::GetColorU32(kBorder));
            ImGui::Dummy(ImVec2(1.0f, height));
        }

        void draw_section_header(const char* label, size_t count) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.08f);
            ImGui::TextUnformatted(label);
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::SameLine(0.0f, 10.0f);
            char count_text[32];
            std::snprintf(count_text, sizeof(count_text), "%zu", count);
            const ImVec2 text_size = ImGui::CalcTextSize(count_text);
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const ImVec2 size(text_size.x + 14.0f, 22.0f);
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddCircleFilled(ImVec2(pos.x + size.x * 0.5f, pos.y + size.y * 0.5f),
                                       size.y * 0.5f,
                                       ImGui::GetColorU32(ImVec4(0.17f, 0.19f, 0.22f, 1.0f)));
            draw_list->AddCircle(ImVec2(pos.x + size.x * 0.5f, pos.y + size.y * 0.5f),
                                 size.y * 0.5f,
                                 ImGui::GetColorU32(kBorder));
            ImGui::SetCursorScreenPos(ImVec2(pos.x + (size.x - text_size.x) * 0.5f,
                                             pos.y + (size.y - text_size.y) * 0.5f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted(count_text);
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(pos);
            ImGui::Dummy(size);
        }

        bool provider_action_button(const char* label, const char* icon_name, const ImVec2& size, bool danger = false) {
            const ImVec4 bg = danger ? ImVec4(0.17f, 0.15f, 0.15f, 1.0f) : ImVec4(0.15f, 0.17f, 0.19f, 1.0f);
            const ImVec4 hovered = danger ? ImVec4(0.26f, 0.17f, 0.17f, 1.0f) : ImVec4(0.20f, 0.22f, 0.25f, 1.0f);
            const ImVec4 active = danger ? ImVec4(0.18f, 0.11f, 0.11f, 1.0f) : ImVec4(0.12f, 0.14f, 0.16f, 1.0f);
            const ImVec4 border = danger ? ImVec4(0.45f, 0.19f, 0.17f, 1.0f) : kBorder;
            const ImVec4 text = danger ? ImVec4(0.97f, 0.39f, 0.34f, 1.0f) : kText;
            ImGui::PushStyleColor(ImGuiCol_Button, bg);
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, hovered);
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, active);
            ImGui::PushStyleColor(ImGuiCol_Border, border);
            ImGui::PushStyleColor(ImGuiCol_Text, text);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const bool pressed = ImGui::Button(("##" + std::string(label)).c_str(), size);
            auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 18);
            const float icon_size = 16.0f;
            const float gap = 8.0f;
            const ImVec2 text_size = ImGui::CalcTextSize(label);
            const float total_width = (icon.id != 0 ? icon_size + gap : 0.0f) + text_size.x;
            const float x = pos.x + (size.x - total_width) * 0.5f;
            const float y = pos.y + (size.y - icon_size) * 0.5f;
            if (icon.id != 0) {
                ImGui::GetWindowDrawList()->AddImage(
                    icon.id,
                    ImVec2(x, y),
                    ImVec2(x + icon_size, y + icon_size),
                    ImVec2(0.0f, 0.0f),
                    ImVec2(1.0f, 1.0f),
                    ImGui::GetColorU32(text));
            }
            ImGui::GetWindowDrawList()->AddText(
                ImVec2(x + (icon.id != 0 ? icon_size + gap : 0.0f), pos.y + (size.y - text_size.y) * 0.5f),
                ImGui::GetColorU32(text),
                label);
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor(5);
            return pressed;
        }

        bool provider_icon_button(const char* id, const char* icon_name, const char* tooltip, const ImVec2& size) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const bool pressed = ImGui::InvisibleButton(id, size);
            const bool hovered = ImGui::IsItemHovered();
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const ImVec4 bg = hovered ? ImVec4(0.20f, 0.22f, 0.25f, 1.0f) : ImVec4(0.15f, 0.17f, 0.19f, 1.0f);
            draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(bg), 8.0f);
            draw_list->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(kBorder), 8.0f);
            auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 24);
            if (icon.id != 0) {
                const float icon_size = 18.0f;
                const ImVec2 icon_pos(pos.x + (size.x - icon_size) * 0.5f, pos.y + (size.y - icon_size) * 0.5f);
                draw_list->AddImage(icon.id, icon_pos, ImVec2(icon_pos.x + icon_size, icon_pos.y + icon_size));
            }
            if (hovered && tooltip) {
                ImGui::SetTooltip("%s", tooltip);
            }
            return pressed;
        }

        void draw_health_metric(const char* label, const std::string& value, float width) {
            ImGui::BeginGroup();
            const ImVec2 start = ImGui::GetCursorScreenPos();
            if (label && label[0] != '\0') {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextUnformatted(label);
                ImGui::PopStyleColor();
                ImGui::SameLine(0.0f, 10.0f);
            }
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::TextUnformatted(value.empty() ? "-" : value.c_str());
            ImGui::PopStyleColor();
            ImGui::SetCursorScreenPos(start);
            ImGui::Dummy(ImVec2(width, 24.0f));
            ImGui::EndGroup();
        }

        bool provider_logs_button(const ImVec2& size) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const bool pressed = ImGui::InvisibleButton("##provider_logs", size);
            const bool hovered = ImGui::IsItemHovered();
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const ImVec4 bg = hovered ? ImVec4(0.19f, 0.21f, 0.24f, 1.0f) : ImVec4(0.14f, 0.16f, 0.18f, 1.0f);
            draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(bg), 8.0f);
            draw_list->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(kBorder), 8.0f);
            auto& icon = core::AssetManager::get().get_svg_texture("log-24", 18);
            if (icon.id != 0) {
                draw_list->AddImage(
                    icon.id,
                    ImVec2(pos.x + 14.0f, pos.y + 8.0f),
                    ImVec2(pos.x + 30.0f, pos.y + 24.0f),
                    ImVec2(0.0f, 0.0f),
                    ImVec2(1.0f, 1.0f),
                    ImGui::GetColorU32(kText));
            }
            draw_list->AddText(ImVec2(pos.x + 38.0f, pos.y + 8.0f), ImGui::GetColorU32(kText), "Logs");
            draw_list->AddCircleFilled(ImVec2(pos.x + size.x - 18.0f, pos.y + size.y * 0.5f), 4.0f, IM_COL32(79, 216, 119, 255));
            return pressed;
        }
    }

    void ProvidersPanel::show_health_card(const ProvidersHealthCard& health) {
        const float width = ImGui::GetContentRegionAvail().x;
        const float logo_block_width = 176.0f;
        const float status_width = 122.0f;
        const float rc_width = 210.0f;
        const float uptime_width = 170.0f;
        const float version_width = 110.0f;
        const float logs_width = 112.0f;

        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 12.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.13f, 0.15f, 0.17f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        if (ImGui::BeginChild("##providers_health_strip", ImVec2(width, 58.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            auto& rclone = core::AssetManager::get().get_svg_texture("rclone-24", 52);
            if (rclone.id != 0) {
                ImGui::Image(rclone.id, ImVec2(26.0f, 26.0f));
            } else {
                ImGui::Dummy(ImVec2(26.0f, 26.0f));
            }
            ImGui::SameLine(0.0f, 10.0f);
            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 2.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.05f);
            ImGui::TextUnformatted("rclone");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::SameLine(logo_block_width, 0.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, health.is_ready ? kAccent : kMuted);
            ImGui::TextUnformatted(health.is_ready ? "Running" : "Unavailable");
            ImGui::PopStyleColor();
            const ImVec2 status_text_min = ImGui::GetItemRectMin();
            ImGui::GetWindowDrawList()->AddCircleFilled(
                ImVec2(status_text_min.x - 12.0f, status_text_min.y + ImGui::GetTextLineHeight() * 0.5f),
                4.0f,
                ImGui::GetColorU32(health.is_ready ? kAccent : kMuted));

            ImGui::SameLine(status_width + logo_block_width, 0.0f);
            draw_vertical_divider(24.0f);
            ImGui::SameLine(0.0f, 28.0f);
            draw_health_metric("RC", strip_metric_label("Port", health.port_text), rc_width);

            ImGui::SameLine(0.0f, 0.0f);
            draw_vertical_divider(24.0f);
            ImGui::SameLine(0.0f, 28.0f);
            draw_health_metric("Uptime", health.uptime_text, uptime_width);

            ImGui::SameLine(0.0f, 0.0f);
            draw_vertical_divider(24.0f);
            ImGui::SameLine(0.0f, 28.0f);
            draw_health_metric("", health.version_text.empty() ? "rclone" : health.version_text, version_width);

            const float log_x = std::max(ImGui::GetCursorPosX() + 12.0f, ImGui::GetWindowContentRegionMax().x - logs_width);
            ImGui::SameLine(log_x, 0.0f);
            provider_logs_button(ImVec2(logs_width, 34.0f));
        }
        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }

    void ProvidersPanel::show_connected_accounts(ProvidersState& state, float max_list_height) {
        const auto all_cards = state.provider_cards_snapshot();
        const auto filtered_cards = state.filtered_provider_cards();
        const bool has_query = !state.search_query().empty();
        bool loading = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            loading = state.is_loading_workflows || state.is_loading_remotes || state.is_loading_remote_statuses;
        }

        ImGui::Dummy(ImVec2(0.0f, 6.0f));
        draw_section_header("Connected Accounts", filtered_cards.size());

        if (filtered_cards.empty()) {
            show_empty_state(has_query && !all_cards.empty(), loading && all_cards.empty());
            return;
        }

        const float width = ImGui::GetContentRegionAvail().x;
        const float height = std::max(48.0f, max_list_height);
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, kThinScrollbarSize);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        if (ImGui::BeginChild("##connected_accounts", ImVec2(width, height), true,
                              ImGuiWindowFlags_None)) {
            for (size_t index = 0; index < filtered_cards.size(); ++index) {
                const ProviderCard& card = filtered_cards[index];
                ImGui::PushID(card.id.c_str());
                const ImVec2 row_start = ImGui::GetCursorScreenPos();
                const float row_width = ImGui::GetContentRegionAvail().x;

                ImGui::SetCursorScreenPos(ImVec2(row_start.x + 22.0f, row_start.y + 17.0f));
                draw_provider_logo(card, 38.0f);

                ImGui::SetCursorScreenPos(ImVec2(row_start.x + 82.0f, row_start.y + 14.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::SetWindowFontScale(1.02f);
                ImGui::TextUnformatted(card.provider_label.c_str());
                ImGui::SetWindowFontScale(1.0f);
                ImGui::PopStyleColor();

                ImGui::SetCursorScreenPos(ImVec2(row_start.x + 82.0f, row_start.y + 40.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextUnformatted(card.account_label.empty() ? card.id.c_str() : card.account_label.c_str());
                ImGui::PopStyleColor();

                const ImVec4 state_color = card.needs_reconnect ? ImVec4(0.96f, 0.68f, 0.28f, 1.0f) : kAccent;
                const ImVec2 status_pos(row_start.x + row_width * 0.34f, row_start.y + 26.0f);
                ImGui::GetWindowDrawList()->AddCircleFilled(
                    ImVec2(status_pos.x + 4.0f, status_pos.y + ImGui::GetTextLineHeight() * 0.5f),
                    3.0f,
                    ImGui::GetColorU32(state_color));
                ImGui::SetCursorScreenPos(ImVec2(status_pos.x + 16.0f, status_pos.y));
                ImGui::PushStyleColor(ImGuiCol_Text, state_color);
                ImGui::TextUnformatted(card.needs_reconnect ? "Reconnect" : "Connected");
                ImGui::PopStyleColor();

                if (card.status_label != "Connected") {
                    ImGui::SetCursorScreenPos(ImVec2(row_start.x + row_width * 0.48f, row_start.y + 26.0f));
                    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                    ImGui::TextUnformatted(card.status_label.c_str());
                    ImGui::PopStyleColor();
                }

                const float button_y = row_start.y + 18.0f;
                const char* primary_label = card.needs_reconnect ? "Reconnect" : (card.unavailable ? "Configure" : "Rename");
                const char* primary_icon = card.needs_reconnect ? "sync-16" : (card.unavailable ? "settings-sync-16" : "pencil-16");
                ImGui::SetCursorScreenPos(ImVec2(row_start.x + row_width - 390.0f, button_y));
                if (provider_action_button(primary_label, primary_icon, ImVec2(108.0f, 34.0f))) {
                    if (card.needs_reconnect) {
                        state.on_request_reconnect(card.id);
                    } else if (card.unavailable) {
                        state.on_request_repair(card.id);
                    } else {
                        state.on_request_rename(card.id);
                    }
                }
                ImGui::SetCursorScreenPos(ImVec2(row_start.x + row_width - 262.0f, button_y));
                if (provider_action_button("Disconnect", "unlink-16", ImVec2(118.0f, 34.0f), true)) {
                    state.on_request_disconnect(card.id);
                }
                ImGui::SetCursorScreenPos(ImVec2(row_start.x + row_width - 126.0f, button_y));
                provider_icon_button("##more", "kebab-horizontal-24", "More actions", ImVec2(48.0f, 34.0f));

                ImGui::SetCursorScreenPos(row_start);
                ImGui::Dummy(ImVec2(row_width, kConnectedRowHeight));
                if (index + 1 < filtered_cards.size()) {
                    ImGui::GetWindowDrawList()->AddLine(
                        ImVec2(row_start.x, row_start.y + kConnectedRowHeight),
                        ImVec2(row_start.x + row_width, row_start.y + kConnectedRowHeight),
                        ImGui::GetColorU32(kBorder));
                }
                ImGui::PopID();
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(3);
    }

    void ProvidersPanel::show_provider_card(ProvidersState& state, const ProviderCard& card, float card_width) {
        constexpr float kCardHeight = 300.0f;
        constexpr float kFooterButtonHeight = 42.0f;
        constexpr float kFooterTopGap = 18.0f;
        constexpr float kFooterBottomPadding = 4.0f;
        constexpr float kLogoSize = 46.0f;

        ImGui::PushID(card.id.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##provider_card", ImVec2(card_width, kCardHeight), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            draw_provider_logo(card, kLogoSize);
            ImGui::SameLine(0.0f, 14.0f);
            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 6.0f);

            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted(card.provider_label.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (!card.account_label.empty()) {
                ImGui::TextUnformatted(card.account_label.c_str());
            } else {
                ImGui::TextUnformatted("Template account");
            }
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            draw_provider_status_badge(card);

            const float content_bottom = ImGui::GetWindowContentRegionMax().y;
            const float min_button_y = ImGui::GetCursorPosY() + kFooterTopGap + 6.0f;
            const float button_y = std::max(
                min_button_y,
                content_bottom - kFooterButtonHeight - kFooterBottomPadding
            );
            const float separator_y = std::max(ImGui::GetCursorPosY() + 14.0f, button_y - kFooterTopGap);

            ImGui::SetCursorPosY(separator_y);
            ImGui::Separator();
            ImGui::SetCursorPosY(button_y);

            const float button_width = (ImGui::GetContentRegionAvail().x - 12.0f) * 0.5f;
            const char* primary_label = card.needs_reconnect ? "Reconnect" : (card.unavailable ? "Configure" : "Rename");
            if (provider_outline_button(primary_label, ImVec2(button_width, kFooterButtonHeight))) {
                if (card.needs_reconnect) {
                    state.on_request_reconnect(card.id);
                } else if (card.unavailable) {
                    state.on_request_repair(card.id);
                } else {
                    state.on_request_rename(card.id);
                }
            }
            ImGui::SameLine(0.0f, 12.0f);
            if (provider_outline_button("Disconnect", ImVec2(button_width, kFooterButtonHeight))) {
                state.on_request_disconnect(card.id);
            }
        }

        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
        ImGui::PopID();
    }

    void ProvidersPanel::show_empty_state(bool filtered, bool loading) {
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##providers_empty_state", ImVec2(0.0f, 180.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.1f);
            if (loading) {
                ImGui::TextUnformatted("Loading providers...");
            } else {
                ImGui::TextUnformatted(filtered ? "No matching providers" : "No providers connected yet");
            }
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (loading) {
                ImGui::TextWrapped("Misty is trying to fetch connected providers and available provider workflows.");
            } else if (filtered) {
                ImGui::TextWrapped("Try a different search term or clear the filter to see all connected providers.");
            } else {
                ImGui::TextWrapped("No providers are connected yet. Use Add Provider to start an rclone-backed setup flow.");
            }
            ImGui::PopStyleColor();
        }

        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }
}
