#include "panels/providers/cards/provider_cards_util.h"

#include "core/manager/asset_manager.h"

#include <algorithm>
#include <cctype>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.945f, 0.933f, 0.910f, 1.0f);
        constexpr ImVec4 kBadgeBg = ImVec4(0.16f, 0.19f, 0.21f, 1.0f);
        constexpr ImVec4 kBadgeText = ImVec4(0.945f, 0.933f, 0.910f, 1.0f);
        constexpr ImVec4 kWarningBadgeBg = ImVec4(0.96f, 0.88f, 0.66f, 1.0f);
        constexpr ImVec4 kWarningBadgeText = ImVec4(0.58f, 0.36f, 0.02f, 1.0f);
        constexpr ImVec4 kMutedBadgeBg = ImVec4(0.29f, 0.32f, 0.36f, 1.0f);
        constexpr ImVec4 kMutedBadgeText = ImVec4(0.82f, 0.85f, 0.88f, 1.0f);

        std::string lowercase_copy(std::string value) {
            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return value;
        }
    }

    std::string provider_logo_path_for_id(const std::string& provider_id) {
        const std::string provider = lowercase_copy(provider_id);
        if (provider.find("onedrive") != std::string::npos || provider.find("microsoft") != std::string::npos) {
            return "assets/icons/onedrive-color.svg";
        }
        if (provider.find("google") != std::string::npos || provider.find("drive") != std::string::npos) {
            return "assets/icons/google-drive-color.svg";
        }
        if (provider.find("dropbox") != std::string::npos) {
            return "assets/icons/dropbox-color.svg";
        }
        if (provider.find("s3") != std::string::npos || provider.find("amazon") != std::string::npos) {
            return "assets/icons/s3-color.svg";
        }
        if (provider.find("sftp") != std::string::npos || provider.find("ssh") != std::string::npos) {
            return "assets/icons/sftp-color.svg";
        }
        return "";
    }

    std::string provider_logo_path(const ProviderCard& card) {
        if (!card.logo_asset_path.empty()) {
            return card.logo_asset_path;
        }
        return provider_logo_path_for_id(card.provider_id);
    }

    void draw_provider_logo(const ProviderCard& card, float size) {
        const std::string path = provider_logo_path(card);
        if (!path.empty()) {
            auto& logo = core::AssetManager::get().get_svg_texture_path(path, static_cast<int>(size * 2.0f), false);
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

    void draw_provider_status_badge(const ProviderCard& card) {
        ImVec4 bg = kBadgeBg;
        ImVec4 text = kBadgeText;
        if (card.needs_reconnect) {
            bg = kWarningBadgeBg;
            text = kWarningBadgeText;
        } else if (card.unavailable || card.status_label == "Checking...") {
            bg = kMutedBadgeBg;
            text = kMutedBadgeText;
        }

        ImGui::PushStyleColor(ImGuiCol_Button, bg);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, bg);
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, bg);
        ImGui::PushStyleColor(ImGuiCol_Text, text);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 999.0f);
        ImGui::Button(card.status_label.c_str(), ImVec2(0.0f, 0.0f));
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(4);
    }

    bool provider_outline_button(const char* label, const ImVec2& size) {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.17f, 0.19f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.20f, 0.22f, 0.25f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.12f, 0.14f, 0.16f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
        const bool pressed = ImGui::Button(label, size);
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(5);
        return pressed;
    }

    void draw_provider_health_status_icon(bool ready) {
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
