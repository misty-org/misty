#include "panels/services/services_panel.h"

#include "core/manager/asset_manager.h"
#include "imgui.h"

#include <string>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kCardBg = ImVec4(0.16f, 0.18f, 0.20f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
        constexpr ImVec4 kBadgeBg = ImVec4(0.77f, 0.94f, 0.79f, 1.0f);
        constexpr ImVec4 kBadgeText = ImVec4(0.18f, 0.49f, 0.23f, 1.0f);

        std::string provider_logo_path(const ServiceCard& card) {
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

        void draw_provider_logo(const ServiceCard& card, float size) {
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
            const float radius = 20.0f;
            const ImVec2 center(pos.x + radius, pos.y + radius);
            const ImU32 fill = ready ? IM_COL32(52, 191, 102, 255) : IM_COL32(119, 127, 137, 255);
            draw_list->AddCircleFilled(center, radius, fill);
            draw_list->AddCircle(center, radius, IM_COL32(22, 26, 31, 45), 0, 1.5f);

            if (ready) {
                draw_list->PathLineTo(ImVec2(center.x - 8.0f, center.y + 0.5f));
                draw_list->PathLineTo(ImVec2(center.x - 2.0f, center.y + 7.0f));
                draw_list->PathLineTo(ImVec2(center.x + 9.0f, center.y - 7.0f));
                draw_list->PathStroke(IM_COL32(255, 255, 255, 255), false, 3.0f);
            } else {
                draw_list->AddLine(ImVec2(center.x - 7.0f, center.y - 7.0f),
                                   ImVec2(center.x + 7.0f, center.y + 7.0f),
                                   IM_COL32(255, 255, 255, 255), 3.0f);
                draw_list->AddLine(ImVec2(center.x + 7.0f, center.y - 7.0f),
                                   ImVec2(center.x - 7.0f, center.y + 7.0f),
                                   IM_COL32(255, 255, 255, 255), 3.0f);
            }

            ImGui::Dummy(ImVec2(radius * 2.0f, radius * 2.0f));
        }
    }

    void ServicesPanel::show_health_card(const ServicesHealthCard& health) {
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(22.0f, 22.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.98f, 0.98f, 0.99f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.88f, 0.90f, 0.92f, 1.0f));

        if (ImGui::BeginChild("##services_health_card", ImVec2(0.0f, 160.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            draw_health_status_icon(health.is_ready);
            ImGui::SameLine(0.0f, 18.0f);

            if (ImGui::BeginTable("##services_health_table", 2, ImGuiTableFlags_SizingStretchProp)) {
                ImGui::TableSetupColumn("left", ImGuiTableColumnFlags_WidthStretch, 0.62f);
                ImGui::TableSetupColumn("right", ImGuiTableColumnFlags_WidthStretch, 0.38f);
                ImGui::TableNextRow();

                ImGui::TableNextColumn();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.10f, 0.12f, 0.16f, 1.0f));
                ImGui::SetWindowFontScale(1.35f);
                ImGui::TextUnformatted(health.title.c_str());
                ImGui::SetWindowFontScale(1.0f);
                if (!health.version_text.empty()) ImGui::TextUnformatted(health.version_text.c_str());
                if (!health.path_text.empty()) ImGui::TextWrapped("%s", health.path_text.c_str());
                if (!health.remote_count_text.empty()) ImGui::TextUnformatted(health.remote_count_text.c_str());
                if (!health.provider_count_text.empty()) ImGui::TextUnformatted(health.provider_count_text.c_str());
                ImGui::PopStyleColor();

                ImGui::TableNextColumn();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.20f, 0.22f, 0.26f, 1.0f));
                ImGui::TextUnformatted(health.status_heading.c_str());
                ImGui::TextUnformatted("");
                ImGui::TextUnformatted("Status");
                ImGui::TextUnformatted(health.status_value.c_str());
                ImGui::PopStyleColor();

                ImGui::EndTable();
            }
        }

        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }

    void ServicesPanel::show_service_card(ServicesState& state, const ServiceCard& card, float card_width) {
        ImGui::PushID(card.id.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##service_card", ImVec2(card_width, 286.0f), true,
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

    void ServicesPanel::show_empty_state(bool filtered) {
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginChild("##services_empty_state", ImVec2(0.0f, 180.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.1f);
            ImGui::TextUnformatted(filtered ? "No matching services" : "No services connected yet");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (filtered) {
                ImGui::TextWrapped("Try a different search term or clear the filter to see all placeholder services once they are added.");
            } else {
                ImGui::TextWrapped("This screen is ready for the new proxy-backed Services flow. Add Service currently opens a placeholder template hook.");
            }
            ImGui::PopStyleColor();
        }

        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }
}
