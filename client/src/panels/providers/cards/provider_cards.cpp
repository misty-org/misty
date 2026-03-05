#include "panels/providers/providers_panel.h"

#include "core/manager/asset_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"

#include <string>

namespace misty::panel {
    namespace UI = misty::UI;

    namespace {
        constexpr ImVec4 kCardBg = ImVec4(0.16f, 0.18f, 0.20f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
        constexpr ImVec4 kBadgeBg = ImVec4(0.77f, 0.94f, 0.79f, 1.0f);
        constexpr ImVec4 kBadgeText = ImVec4(0.18f, 0.49f, 0.23f, 1.0f);

        std::string provider_logo_path(const ProviderCard& card) {
            if (!card.logo_asset_path.empty()) {
                return card.logo_asset_path;
            }
            if (card.provider_id == "drive") return "assets/icons/google-drive-color.svg";
            if (card.provider_id == "onedrive") return "assets/icons/onedrive-color.svg";
            if (card.provider_id == "dropbox") return "assets/icons/dropbox-color.svg";
            if (card.provider_id == "s3") return "assets/icons/s3-color.svg";
            if (card.provider_id == "sftp") return "assets/icons/sftp-color.svg";
            return "";
        }

        void draw_provider_logo(const ProviderCard& card, float size) {
            const std::string path = provider_logo_path(card);
            if (!path.empty()) {
                auto& logo = core::AssetManager::get().get_svg_texture_path(path, static_cast<int>(size), false);
                if (logo.id != 0) {
                    ImGui::Image(logo.id, ImVec2(size, size));
                    return;
                }
            }

            auto& icon = core::AssetManager::get().get_svg_texture("cloud-24", static_cast<int>(size * 2.0f));
            if (icon.id != 0) {
                ImGui::Image(icon.id, ImVec2(size, size));
            } else {
                ImGui::Dummy(ImVec2(size, size));
            }
        }

        void draw_status_badge(const std::string& label) {
            ImGui::PushStyleColor(ImGuiCol_Button, kBadgeBg);
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kBadgeBg);
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, kBadgeBg);
            ImGui::PushStyleColor(ImGuiCol_Text, kBadgeText);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 999.0f);
            ImGui::Button(label.c_str(), ImVec2(0.0f, 0.0f));
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(4);
        }

        bool outline_button(const char* label, const ImVec2& size) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.17f, 0.19f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.20f, 0.22f, 0.25f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.12f, 0.14f, 0.16f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
            bool pressed = ImGui::Button(label, size);
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor(5);
            return pressed;
        }

        void draw_health_status_icon(bool ready) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const float radius = 8.0f;
            const ImVec2 center(pos.x + radius, pos.y + radius);
            const ImU32 fill = ready ? IM_COL32(52, 191, 102, 255) : IM_COL32(119, 127, 137, 255);
            draw_list->AddCircleFilled(center, radius, fill);
            draw_list->AddCircle(center, radius, IM_COL32(22, 26, 31, 45), 0, 1.5f);

            if (ready) {
                draw_list->PathLineTo(ImVec2(center.x - 3.5f, center.y + 0.5f));
                draw_list->PathLineTo(ImVec2(center.x - 0.8f, center.y + 3.5f));
                draw_list->PathLineTo(ImVec2(center.x + 4.5f, center.y - 4.0f));
                draw_list->PathStroke(IM_COL32(255, 255, 255, 255), false, 2.0f);
            } else {
                draw_list->AddLine(ImVec2(center.x - 3.5f, center.y - 3.5f),
                                   ImVec2(center.x + 3.5f, center.y + 3.5f),
                                   IM_COL32(255, 255, 255, 255), 2.0f);
                draw_list->AddLine(ImVec2(center.x + 3.5f, center.y - 3.5f),
                                   ImVec2(center.x - 3.5f, center.y + 3.5f),
                                   IM_COL32(255, 255, 255, 255), 2.0f);
            }

            ImGui::Dummy(ImVec2(radius * 2.0f, radius * 2.0f));
        }
    }

    void ProvidersPanel::show_health_card(const ProvidersHealthCard& health) {
        UI::row("providers_status_row", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .align = UI::Align::Center,
            .gap = UI::Spacing::xy(12.0f, 0.0f),
        }, [&]() {
            UI::text({
                .text = "Status",
                .width = UI::Size::auto_size(),
                .color = kMuted,
            });

            UI::raw([&]() {
                draw_health_status_icon(health.is_ready);
            });

            UI::text({
                .text = health.status_value.c_str(),
                .width = UI::Size::auto_size(),
                .color = health.is_ready ? ImVec4(0.48f, 0.86f, 0.59f, 1.0f) : ImVec4(0.96f, 0.48f, 0.48f, 1.0f),
            });
        });

        std::string details;
        auto append_detail = [&](const std::string& value) {
            if (value.empty()) {
                return;
            }
            if (!details.empty()) {
                details += "  •  ";
            }
            details += value;
        };
        append_detail(health.port_text);
        append_detail(health.uptime_text);
        append_detail(health.provider_count_text);
        append_detail(health.remote_count_text);

        if (!details.empty()) {
            UI::text({
                .text = details.c_str(),
                .width = UI::Size::fill(),
                .color = kMuted,
                .overflow = UI::TextOverflow::Wrap,
            });
        }

        UI::divider({
            .width = UI::Size::fill(),
            .height = UI::Size::px(1.0f),
            .margin = UI::Spacing::top_bottom(18.0f, 0.0f),
            .color = kBorder,
        });
    }

    void ProvidersPanel::show_provider_card(ProvidersState& state, const ProviderCard& card, float card_width) {
        ImGui::PushID(card.id.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##provider_card", ImVec2(card_width, 286.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            draw_provider_logo(card, 46.0f);
            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted(card.provider_label.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (!card.account_label.empty()) {
                ImGui::TextUnformatted(card.account_label.c_str());
            } else {
                ImGui::TextUnformatted("Template account");
            }
            ImGui::PopStyleColor();

            draw_status_badge(card.status_label.empty() ? "Connected" : card.status_label);

            const float footer_top = ImGui::GetCursorPosY() + 18.0f;
            ImGui::SetCursorPosY(footer_top);
            ImGui::Separator();
            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 14.0f);

            const float button_width = (ImGui::GetContentRegionAvail().x - 12.0f) * 0.5f;
            if (outline_button("Rename", ImVec2(button_width, 42.0f))) {
                state.on_request_rename(card.id);
            }
            ImGui::SameLine(0.0f, 12.0f);
            if (outline_button("Disconnect", ImVec2(button_width, 42.0f))) {
                state.on_request_disconnect(card.id);
            }
        }

        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
        ImGui::PopID();
    }

    void ProvidersPanel::show_empty_state(bool filtered) {
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##providers_empty_state", ImVec2(0.0f, 180.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.1f);
            ImGui::TextUnformatted(filtered ? "No matching providers" : "No providers connected yet");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (filtered) {
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
