#include "panels/providers/dialogs/onedrive_dialogs.h"

#include "imgui.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/dialogs/provider_dialogs_util.h"
#include "panels/providers/layout/providers_layout_util.h"

#include <algorithm>
#include <cctype>
#include <mutex>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kPanelBg = ImVec4(0.08f, 0.11f, 0.14f, 1.0f);
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
        constexpr ImVec4 kError = ImVec4(0.95f, 0.49f, 0.49f, 1.0f);

        std::string normalized_onedrive_key(std::string value) {
            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            value.erase(std::remove_if(value.begin(), value.end(), [](char c) {
                return c == '-' || c == '_' || c == ' ';
            }), value.end());
            return value;
        }
    }

    bool is_onedrive_provider_type(const std::string& value) {
        const std::string key = normalized_onedrive_key(value);
        return key.find("onedrive") != std::string::npos ||
            key.find("microsoft") != std::string::npos;
    }

    bool status_needs_onedrive_drive_repair(const ProviderRemoteStatus* status) {
        if (!status) {
            return false;
        }
        const std::string haystack = normalized_onedrive_key(
            status->status_label + " " + status->error + " " + status->type);
        return is_onedrive_provider_type(haystack) &&
            (haystack.find("driveid") != std::string::npos ||
             haystack.find("drivetype") != std::string::npos);
    }

    std::vector<ProviderOption> onedrive_drive_repair_options() {
        ProviderOption config_type;
        config_type.name = "config_type";
        config_type.label = "Type of connection";
        config_type.help = "Choose the OneDrive connection type rclone should configure.";
        config_type.default_value = "onedrive";
        config_type.required = true;
        config_type.choices = {
            {"onedrive", "OneDrive Personal or Business"},
            {"sharepoint", "Root SharePoint site"},
            {"search", "Search a SharePoint site"},
        };

        ProviderOption drive_id;
        drive_id.name = "drive_id";
        drive_id.label = "The ID of the drive to use";
        drive_id.help = "Enter the drive ID rclone should save for this remote.";
        drive_id.required = true;

        ProviderOption drive_type;
        drive_type.name = "drive_type";
        drive_type.label = "The type of the drive";
        drive_type.help = "Choose the rclone drive type: personal, business, or documentLibrary.";
        drive_type.required = true;
        drive_type.choices = {
            {"personal", "Personal drive"},
            {"business", "Business drive"},
            {"documentLibrary", "Document library"},
        };

        return {config_type, drive_id, drive_type};
    }

    std::vector<ProviderOption> onedrive_visible_drive_repair_options(const ActiveProviderConfigSession& session) {
        std::string config_type = "onedrive";
        if (const auto it = session.parameters.find("config_type"); it != session.parameters.end() && !it->second.empty()) {
            config_type = it->second;
        }

        std::vector<ProviderOption> options = onedrive_drive_repair_options();
        if (config_type == "driveid") {
            return options;
        }

        options.erase(std::remove_if(options.begin(), options.end(), [](const ProviderOption& option) {
            return option.name == "drive_id" || option.name == "drive_type";
        }), options.end());
        return options;
    }

    void show_onedrive_drive_repair_dialog(ProvidersState& state) {
        ActiveProviderConfigSession session;
        bool open = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            open = state.show_onedrive_repair_modal;
        }
        if (!open) {
            return;
        }
        session = state.add_provider_session_snapshot();

        const char* popup_name = "##providers_onedrive_drive_repair";
        if (!ImGui::IsPopupOpen(popup_name)) {
            ImGui::OpenPopup(popup_name);
        }

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        const float modal_width = std::min(620.0f, viewport->WorkSize.x - 48.0f);
        ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(modal_width, 0.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(28.0f, 26.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, kPanelBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginPopupModal(popup_name, nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                       ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.25f);
            ImGui::TextUnformatted("Reconnect OneDrive");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextWrapped("This OneDrive remote has OAuth credentials, but rclone is missing the drive metadata it needs to mount the account.");
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 18.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::TextUnformatted(session.remote_name.c_str());
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0.0f, 16.0f));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 16.0f));

            if (session.submit_in_flight) {
                ImGui::BeginDisabled();
            }
            const std::vector<ProviderOption> options = session.current_option.has_value()
                ? std::vector<ProviderOption>{*session.current_option}
                : onedrive_visible_drive_repair_options(session);
            for (const auto& option : options) {
                render_provider_option_editor(state, option, session);
                ImGui::Dummy(ImVec2(0.0f, 12.0f));
            }
            if (session.submit_in_flight) {
                ImGui::EndDisabled();
            }

            if (!session.inline_error.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, kError);
                ImGui::TextWrapped("%s", session.inline_error.c_str());
                ImGui::PopStyleColor();
                ImGui::Dummy(ImVec2(0.0f, 12.0f));
            }

            ImGui::Dummy(ImVec2(0.0f, 10.0f));
            const float button_width = 170.0f;
            ImGui::SetCursorPosX(modal_width - button_width * 2.0f - 70.0f);
            if (provider_outline_button("Cancel", ImVec2(button_width, 42.0f))) {
                state.dismiss_active_dialog();
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine(0.0f, 16.0f);
            if (session.submit_in_flight) {
                ImGui::BeginDisabled();
            }
            if (provider_teal_button("Continue", ImVec2(button_width, 42.0f))) {
                state.submit_add_provider();
            }
            if (session.submit_in_flight) {
                ImGui::EndDisabled();
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }
}
