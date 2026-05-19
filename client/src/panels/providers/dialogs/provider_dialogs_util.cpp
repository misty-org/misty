#include "panels/providers/dialogs/provider_dialogs_util.h"

#include <array>
#include <cstdio>

#include "imgui.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/layout/providers_layout_util.h"

namespace misty::panel {
    namespace {
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);

        void render_provider_text_option_editor(
            ProvidersState& state,
            const ProviderOption& option,
            const std::string& value
        ) {
            std::array<char, 512> buffer{};
            std::snprintf(buffer.data(), buffer.size(), "%s", value.c_str());

            const ImGuiInputTextFlags flags = option.password ? ImGuiInputTextFlags_Password : ImGuiInputTextFlags_None;
            const std::string label = option.required ? option.name + " *" : option.name;
            if (ImGui::InputText(label.c_str(), buffer.data(), buffer.size(), flags)) {
                state.set_parameter_value(option.name, buffer.data());
            }

            if (!option.help.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", option.help.c_str());
                ImGui::PopStyleColor();
            }
        }

        void render_provider_choice_option_editor(
            ProvidersState& state,
            const ProviderOption& option,
            const std::string& value
        ) {
            std::string current_value = value;
            if (current_value.empty() && !option.default_value.empty()) {
                current_value = option.default_value;
            }
            if (current_value.empty() && !option.choices.empty()) {
                current_value = option.choices.front().value;
            }

            const std::string preview =
                current_value.empty() ? "Select a value" : provider_preview_label(option, current_value);
            const std::string label = option.required ? option.name + " *" : option.name;
            if (ImGui::BeginCombo(label.c_str(), preview.c_str())) {
                for (const auto& choice : option.choices) {
                    const bool selected = choice.value == current_value;
                    const std::string choice_label = provider_choice_label(choice);
                    if (ImGui::Selectable(choice_label.c_str(), selected)) {
                        state.set_parameter_value(option.name, choice.value);
                        current_value = choice.value;
                    }
                    if (!choice.help.empty() && choice.help != choice_label && ImGui::IsItemHovered()) {
                        ImGui::SetTooltip("%s", choice.help.c_str());
                    }
                    if (selected) {
                        ImGui::SetItemDefaultFocus();
                    }
                }
                ImGui::EndCombo();
            }

            if (!option.help.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", option.help.c_str());
                ImGui::PopStyleColor();
            }
        }
    }

    const ProviderWorkflow* selected_provider_workflow(
        const std::vector<ProviderWorkflow>& workflows,
        const std::string& provider_type
    ) {
        for (const auto& workflow : workflows) {
            if (workflow.type == provider_type) {
                return &workflow;
            }
        }
        return nullptr;
    }

    std::string provider_parameter_value(const ActiveProviderConfigSession& session, const std::string& key) {
        const auto it = session.parameters.find(key);
        return it == session.parameters.end() ? std::string{} : it->second;
    }

    std::string provider_choice_label(const ProviderChoice& choice) {
        if (!choice.help.empty()) {
            return choice.help;
        }
        return choice.value;
    }

    std::string provider_preview_label(const ProviderOption& option, const std::string& value) {
        for (const auto& choice : option.choices) {
            if (choice.value == value) {
                return provider_choice_label(choice);
            }
        }
        return value;
    }

    ProviderDialogText provider_dialog_text(const ActiveProviderConfigSession& session) {
        ProviderDialogText text;
        if (session.repair_mode) {
            text.title = "Configure Provider";
            text.intro = "Misty will re-run the provider setup flow so you can configure this provider again.";
            text.primary_button_label = "Configure Provider";
            return text;
        }
        if (session.reconnect_mode) {
            text.title = "Reconnect Provider";
            text.intro = "Misty will reopen the browser sign-in flow and refresh the saved credentials for this provider.";
            text.primary_button_label = "Reconnect Provider";
            return text;
        }
        text.title = "Add Provider";
        text.intro = "Choose a provider, name the remote, and Misty will finish the browser sign-in flow for you.";
        text.primary_button_label = "Create Provider";
        return text;
    }

    void render_provider_option_editor(
        ProvidersState& state,
        const ProviderOption& option,
        const ActiveProviderConfigSession& session
    ) {
        const std::string value = provider_parameter_value(session, option.name);
        if (!option.choices.empty()) {
            render_provider_choice_option_editor(state, option, value);
            return;
        }
        render_provider_text_option_editor(state, option, value);
    }

    void show_provider_placeholder_popup(ProvidersState& state, bool open, const char* popup_name, const char* title) {
        if (!open) {
            return;
        }

        std::string pending_id;
        std::string message;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            pending_id = state.pending_provider_id;
            message = state.dialog_message;
        }

        if (!ImGui::IsPopupOpen(popup_name)) {
            ImGui::OpenPopup(popup_name);
        }

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(420.0f, 0.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(22.0f, 22.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.12f, 0.13f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginPopupModal(popup_name, nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                       ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted(title);
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextWrapped("%s", message.c_str());
            if (!pending_id.empty()) {
                ImGui::Spacing();
                ImGui::TextWrapped("Selected provider id: %s", pending_id.c_str());
            }
            ImGui::PopStyleColor();

            ImGui::Spacing();
            if (provider_outline_button("Close", ImVec2(-1.0f, 40.0f))) {
                state.dismiss_active_dialog();
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }

    void show_provider_disconnect_popup(ProvidersState& state, bool open) {
        if (!open) {
            return;
        }

        std::string pending_id;
        std::string message;
        bool disconnect_in_flight = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            pending_id = state.pending_provider_id;
            message = state.dialog_message;
            disconnect_in_flight = state.disconnect_in_flight;
        }

        const char* popup_name = "##providers_disconnect_confirm";
        if (!ImGui::IsPopupOpen(popup_name)) {
            ImGui::OpenPopup(popup_name);
        }

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(460.0f, 0.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(22.0f, 22.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.12f, 0.13f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginPopupModal(popup_name, nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                       ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted("Disconnect Provider");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            if (!message.empty()) {
                ImGui::TextWrapped("%s", message.c_str());
            }
            if (!pending_id.empty()) {
                ImGui::Spacing();
                ImGui::TextWrapped("Provider: %s", pending_id.c_str());
            }
            ImGui::PopStyleColor();

            ImGui::Spacing();
            if (disconnect_in_flight) {
                ImGui::BeginDisabled();
            }
            if (provider_teal_button("Disconnect", ImVec2(210.0f, 40.0f))) {
                state.confirm_disconnect();
            }
            if (disconnect_in_flight) {
                ImGui::EndDisabled();
            }

            ImGui::SameLine(0.0f, 12.0f);
            if (disconnect_in_flight) {
                ImGui::BeginDisabled();
            }
            if (provider_outline_button("Cancel", ImVec2(210.0f, 40.0f))) {
                state.dismiss_active_dialog();
                ImGui::CloseCurrentPopup();
            }
            if (disconnect_in_flight) {
                ImGui::EndDisabled();
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }
}
