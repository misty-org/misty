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
        constexpr ImVec4 kWarning = ImVec4(0.96f, 0.68f, 0.28f, 1.0f);
        constexpr float kConnectedRowHeight = 72.0f;
        constexpr float kConnectedHeaderHeight = 40.0f;
        constexpr float kRcloneHeaderHeight = 34.0f;
        constexpr float kRcloneRowHeight = 56.0f;
        constexpr float kThinScrollbarSize = 8.0f;

        std::string strip_metric_label(const std::string& label, const std::string& value) {
            const std::string prefix = std::string(label) + " ";
            if (value.rfind(prefix, 0) == 0) {
                return value.substr(prefix.size());
            }
            return value;
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

        void draw_connected_accounts_header(float row_width) {
            const ImVec2 header_start = ImGui::GetCursorScreenPos();
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddRectFilled(
                header_start,
                ImVec2(header_start.x + row_width, header_start.y + kConnectedHeaderHeight),
                ImGui::GetColorU32(ImVec4(0.11f, 0.13f, 0.15f, 1.0f)));
            draw_list->AddLine(
                ImVec2(header_start.x, header_start.y + kConnectedHeaderHeight),
                ImVec2(header_start.x + row_width, header_start.y + kConnectedHeaderHeight),
                ImGui::GetColorU32(kBorder));

            const float label_y = header_start.y + 11.0f;
            const struct {
                const char* label;
                float x;
            } columns[] = {
                {"Provider", 22.0f},
                {"Status", row_width * 0.34f},
                {"Details", row_width * 0.50f},
                {"Actions", row_width - 390.0f},
            };

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            for (const auto& column : columns) {
                ImGui::SetCursorScreenPos(ImVec2(header_start.x + column.x, label_y));
                ImGui::TextUnformatted(column.label);
            }
            ImGui::PopStyleColor();

            ImGui::SetCursorScreenPos(ImVec2(header_start.x, header_start.y + kConnectedHeaderHeight));
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
            constexpr float icon_size = 16.0f;
            const ImVec2 text_size = ImGui::CalcTextSize("Logs");
            const float center_y = pos.y + size.y * 0.5f;
            if (icon.id != 0) {
                draw_list->AddImage(
                    icon.id,
                    ImVec2(pos.x + 14.0f, center_y - icon_size * 0.5f),
                    ImVec2(pos.x + 14.0f + icon_size, center_y + icon_size * 0.5f),
                    ImVec2(0.0f, 0.0f),
                    ImVec2(1.0f, 1.0f),
                    ImGui::GetColorU32(kText));
            }
            draw_list->AddText(ImVec2(pos.x + 38.0f, center_y - text_size.y * 0.5f), ImGui::GetColorU32(kText), "Logs");
            draw_list->AddCircleFilled(ImVec2(pos.x + size.x - 18.0f, center_y), 4.0f, IM_COL32(79, 216, 119, 255));
            return pressed;
        }

        void draw_rclone_header(ImDrawList* draw_list,
                                const ImVec2& min,
                                const ImVec2& max,
                                float status_min_x,
                                float rc_min_x,
                                float uptime_min_x,
                                float version_min_x,
                                float actions_min_x) {
            draw_list->AddRectFilled(
                min,
                ImVec2(max.x, min.y + kRcloneHeaderHeight),
                ImGui::GetColorU32(ImVec4(0.11f, 0.13f, 0.15f, 1.0f)));
            draw_list->AddLine(
                ImVec2(min.x, min.y + kRcloneHeaderHeight),
                ImVec2(max.x, min.y + kRcloneHeaderHeight),
                ImGui::GetColorU32(kBorder));

            const float label_y = min.y + 8.0f;
            const struct {
                const char* label;
                float x;
            } columns[] = {
                {"Service", min.x + 22.0f},
                {"Status", status_min_x + 22.0f},
                {"RC", rc_min_x + 22.0f},
                {"Uptime", uptime_min_x + 22.0f},
                {"Version", version_min_x + 22.0f},
                {"Actions", actions_min_x},
            };

            for (const auto& column : columns) {
                draw_list->AddText(ImVec2(column.x, label_y), ImGui::GetColorU32(kMuted), column.label);
            }
        }

        void draw_centered_text_pair(ImDrawList* draw_list,
                                     const ImVec2& min,
                                     const ImVec2& max,
                                     const char* label,
                                     const std::string& value) {
            const char* display_value = value.empty() ? "-" : value.c_str();
            const bool has_label = label && label[0] != '\0';
            const float gap = has_label ? 10.0f : 0.0f;
            const ImVec2 label_size = has_label ? ImGui::CalcTextSize(label) : ImVec2(0.0f, 0.0f);
            const ImVec2 value_size = ImGui::CalcTextSize(display_value);
            const float total_width = label_size.x + gap + value_size.x;
            float x = min.x + std::max(0.0f, (max.x - min.x - total_width) * 0.5f);
            const float y = min.y + (max.y - min.y - value_size.y) * 0.5f;

            if (has_label) {
                draw_list->AddText(ImVec2(x, y), ImGui::GetColorU32(kMuted), label);
                x += label_size.x + gap;
            }
            draw_list->AddText(ImVec2(x, y), ImGui::GetColorU32(kText), display_value);
        }

        void draw_centered_icon_text(ImDrawList* draw_list,
                                     const ImVec2& min,
                                     const ImVec2& max,
                                     ImTextureID icon_id,
                                     float icon_size,
                                     const char* text,
                                     ImU32 text_color) {
            constexpr float gap = 10.0f;
            const ImVec2 text_size = ImGui::CalcTextSize(text);
            const float total_width = (icon_id != 0 ? icon_size + gap : 0.0f) + text_size.x;
            float x = min.x + std::max(0.0f, (max.x - min.x - total_width) * 0.5f);
            const float center_y = (min.y + max.y) * 0.5f;

            if (icon_id != 0) {
                draw_list->AddImage(
                    icon_id,
                    ImVec2(x, center_y - icon_size * 0.5f),
                    ImVec2(x + icon_size, center_y + icon_size * 0.5f));
                x += icon_size + gap;
            }
            draw_list->AddText(ImVec2(x, center_y - text_size.y * 0.5f), text_color, text);
        }

        void draw_centered_status(ImDrawList* draw_list,
                                  const ImVec2& min,
                                  const ImVec2& max,
                                  const char* text,
                                  ImU32 dot_color,
                                  ImU32 text_color) {
            const ImVec2 text_size = ImGui::CalcTextSize(text);
            constexpr float dot_radius = 4.0f;
            constexpr float gap = 14.0f;
            const float total_width = dot_radius * 2.0f + gap + text_size.x;
            const float x = min.x + std::max(0.0f, (max.x - min.x - total_width) * 0.5f);
            const float center_y = (min.y + max.y) * 0.5f;
            draw_list->AddCircleFilled(ImVec2(x + dot_radius, center_y), dot_radius, dot_color);
            draw_list->AddText(ImVec2(x + dot_radius * 2.0f + gap, center_y - text_size.y * 0.5f),
                               text_color,
                               text);
        }
    }

    void ProvidersPanel::show_health_card(const ProvidersHealthCard& health) {
        const float width = ImGui::GetContentRegionAvail().x;
        const float logs_width = 112.0f;

        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.13f, 0.15f, 0.17f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        if (ImGui::BeginChild("##providers_health_strip", ImVec2(width, kRcloneHeaderHeight + kRcloneRowHeight), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const ImVec2 window_pos = ImGui::GetWindowPos();
            const ImVec2 content_min = ImGui::GetWindowContentRegionMin();
            const ImVec2 content_max = ImGui::GetWindowContentRegionMax();
            const ImVec2 min(window_pos.x + content_min.x, window_pos.y + content_min.y);
            const ImVec2 max(window_pos.x + content_max.x, window_pos.y + content_max.y);
            const ImVec2 row_min(min.x, min.y + kRcloneHeaderHeight);
            const ImVec2 row_max(max.x, max.y);
            const float center_y = (row_min.y + row_max.y) * 0.5f;

            const float content_pad_x = 20.0f;
            const float logs_x = max.x - content_pad_x - logs_width;
            const float cells_max_x = logs_x - 34.0f;
            const float cells_width = std::max(1.0f, cells_max_x - (min.x + content_pad_x));
            const float brand_min_x = min.x + content_pad_x;
            const float brand_max_x = brand_min_x + cells_width * 0.16f;
            const float status_min_x = brand_max_x;
            const float status_max_x = status_min_x + cells_width * 0.15f;
            const float rc_min_x = status_max_x;
            const float rc_max_x = rc_min_x + cells_width * 0.21f;
            const float uptime_min_x = rc_max_x;
            const float uptime_max_x = uptime_min_x + cells_width * 0.18f;
            const float version_min_x = uptime_max_x;
            const float version_max_x = version_min_x + cells_width * 0.16f;

            draw_rclone_header(draw_list,
                                min,
                                max,
                                status_min_x,
                                rc_min_x,
                                uptime_min_x,
                                version_min_x,
                                logs_x);

            auto& rclone = core::AssetManager::get().get_svg_texture("rclone-24", 52);
            draw_centered_icon_text(
                draw_list,
                ImVec2(brand_min_x, row_min.y),
                ImVec2(brand_max_x, row_max.y),
                rclone.id,
                26.0f,
                "rclone",
                ImGui::GetColorU32(kText));

            const char* status_text = health.is_ready ? "Running" : "Unavailable";
            draw_centered_status(
                draw_list,
                ImVec2(status_min_x, row_min.y),
                ImVec2(status_max_x, row_max.y),
                status_text,
                ImGui::GetColorU32(health.is_ready ? kAccent : kMuted),
                ImGui::GetColorU32(health.is_ready ? kText : kMuted));

            const std::string rc_port = strip_metric_label("Port", health.port_text);
            draw_centered_text_pair(
                draw_list,
                ImVec2(rc_min_x, row_min.y),
                ImVec2(rc_max_x, row_max.y),
                "",
                rc_port.empty() ? std::string{} : "localhost:" + rc_port);

            draw_centered_text_pair(draw_list, ImVec2(uptime_min_x, row_min.y), ImVec2(uptime_max_x, row_max.y),
                                    "", health.uptime_text);

            draw_centered_text_pair(draw_list, ImVec2(version_min_x, row_min.y), ImVec2(version_max_x, row_max.y),
                                    "", health.version_text.empty() ? "rclone" : health.version_text);

            ImGui::SetCursorScreenPos(ImVec2(logs_x, center_y - 17.0f));
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

        ImGui::Dummy(ImVec2(0.0f, 10.0f));
        const float width = ImGui::GetContentRegionAvail().x;
        const float content_height = kConnectedHeaderHeight + kConnectedRowHeight * static_cast<float>(filtered_cards.size());
        const float available_height = std::max(48.0f, max_list_height);
        const float height = std::max(48.0f, std::min(content_height, available_height));
        const bool needs_scroll = content_height > available_height + 0.5f;
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, kThinScrollbarSize);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        const ImGuiWindowFlags list_flags = needs_scroll
            ? ImGuiWindowFlags_None
            : (ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
        if (ImGui::BeginChild("##connected_accounts", ImVec2(width, height), true, list_flags)) {
            const float row_width = ImGui::GetContentRegionAvail().x;
            draw_connected_accounts_header(row_width);
            for (size_t index = 0; index < filtered_cards.size(); ++index) {
                const ProviderCard& card = filtered_cards[index];
                ImGui::PushID(card.id.c_str());
                const ImVec2 row_start = ImGui::GetCursorScreenPos();

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

                const ImVec4 state_color = card.needs_reconnect ? kWarning : kAccent;
                const ImVec2 status_pos(row_start.x + row_width * 0.34f, row_start.y + 26.0f);
                ImGui::GetWindowDrawList()->AddCircleFilled(
                    ImVec2(status_pos.x + 4.0f, status_pos.y + ImGui::GetTextLineHeight() * 0.5f),
                    3.0f,
                    ImGui::GetColorU32(state_color));
                ImGui::SetCursorScreenPos(ImVec2(status_pos.x + 16.0f, status_pos.y));
                ImGui::PushStyleColor(ImGuiCol_Text, card.needs_reconnect ? kWarning : kText);
                ImGui::TextUnformatted(card.needs_reconnect ? "Reconnect" : "Connected");
                ImGui::PopStyleColor();

                if (card.status_label != "Connected") {
                    ImGui::SetCursorScreenPos(ImVec2(row_start.x + row_width * 0.50f, row_start.y + 26.0f));
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
