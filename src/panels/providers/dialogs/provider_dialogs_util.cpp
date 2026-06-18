#include "panels/providers/dialogs/provider_dialogs_util.h"

#include <array>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <string>

#include "imgui.h"
#include <nlohmann/json.hpp>
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/layout/providers_layout_util.h"
#include "panels/providers/state/providers_state_util.h"

namespace misty::panel {
    namespace {
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.945f, 0.933f, 0.910f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.788f, 0.769f, 0.737f, 1.0f);

        std::string normalized_provider_key(std::string value) {
            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            value.erase(std::remove_if(value.begin(), value.end(), [](char c) {
                return c == '-' || c == '_' || c == ' ';
            }), value.end());
            return value;
        }

        std::string trim_provider_text(std::string value) {
            auto is_space = [](unsigned char c) {
                return std::isspace(c) != 0;
            };
            value.erase(value.begin(), std::find_if(value.begin(), value.end(), [&](unsigned char c) {
                return !is_space(c);
            }));
            value.erase(std::find_if(value.rbegin(), value.rend(), [&](unsigned char c) {
                return !is_space(c);
            }).base(), value.end());
            return value;
        }

        std::string first_help_line(const std::string& help) {
            const std::string trimmed = trim_provider_text(help);
            const auto paragraph = trimmed.find("\n\n");
            const std::string first_paragraph = paragraph == std::string::npos
                ? trimmed
                : trimmed.substr(0, paragraph);
            const auto newline = first_paragraph.find('\n');
            return trim_provider_text(newline == std::string::npos
                ? first_paragraph
                : first_paragraph.substr(0, newline));
        }

        std::string title_from_option_name(std::string value) {
            std::replace(value.begin(), value.end(), '_', ' ');
            std::replace(value.begin(), value.end(), '-', ' ');
            bool capitalize = true;
            for (char& c : value) {
                if (std::isspace(static_cast<unsigned char>(c))) {
                    capitalize = true;
                    continue;
                }
                if (capitalize) {
                    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
                    capitalize = false;
                }
            }
            return value;
        }

        std::string provider_option_prompt(const ProviderOption& option) {
            if (!option.label.empty()) {
                return option.label;
            }
            const std::string help_line = first_help_line(option.help);
            if (!help_line.empty()) {
                return help_line;
            }
            return title_from_option_name(option.name);
        }

        std::string pretty_json_or_text(const std::string& value) {
            if (value.empty()) {
                return "";
            }
            auto parsed = nlohmann::json::parse(value, nullptr, false);
            if (parsed.is_discarded()) {
                return value;
            }
            const auto redact = [](auto&& self, nlohmann::json& node) -> void {
                if (node.is_object()) {
                    for (auto it = node.begin(); it != node.end(); ++it) {
                        const std::string key = lowercase_provider_copy(it.key());
                        if (key.find("token") != std::string::npos ||
                            key.find("password") != std::string::npos ||
                            key.find("secret") != std::string::npos) {
                            it.value() = "<redacted>";
                        } else {
                            self(self, it.value());
                        }
                    }
                } else if (node.is_array()) {
                    for (auto& item : node) {
                        self(self, item);
                    }
                }
            };
            redact(redact, parsed);
            return parsed.dump(2);
        }

        std::string provider_option_help(const ProviderOption& option, const std::string& prompt) {
            const std::string help = trim_provider_text(option.help);
            if (help.empty()) {
                return {};
            }
            std::string normalized_prompt = trim_provider_text(prompt);
            if (!normalized_prompt.empty() && normalized_prompt.back() == '.') {
                normalized_prompt.pop_back();
            }
            std::string normalized_help = help;
            if (!normalized_help.empty() && normalized_help.back() == '.') {
                normalized_help.pop_back();
            }
            return normalized_help == normalized_prompt ? std::string{} : help;
        }

        void render_provider_option_prompt(const ProviderOption& option, const std::string& prompt) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::TextWrapped("%s%s", prompt.c_str(), option.required ? " *" : "");
            ImGui::PopStyleColor();
            ImGui::Dummy(ImVec2(0.0f, 6.0f));
        }

        void render_provider_text_option_editor(
            ProvidersState& state,
            const ProviderOption& option,
            const std::string& value
        ) {
            const std::string prompt = provider_option_prompt(option);
            render_provider_option_prompt(option, prompt);

            std::array<char, 512> buffer{};
            std::snprintf(buffer.data(), buffer.size(), "%s", value.c_str());

            const ImGuiInputTextFlags flags = option.password ? ImGuiInputTextFlags_Password : ImGuiInputTextFlags_None;
            ImGui::SetNextItemWidth(-1.0f);
            const std::string input_id = "##provider_option_" + option.name;
            if (ImGui::InputText(input_id.c_str(), buffer.data(), buffer.size(), flags)) {
                state.set_parameter_value(option.name, buffer.data());
            }

            const std::string help = provider_option_help(option, prompt);
            if (!help.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", help.c_str());
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

            const std::string prompt = provider_option_prompt(option);
            render_provider_option_prompt(option, prompt);

            const std::string preview =
                current_value.empty() ? "Select a value" : provider_preview_label(option, current_value);
            ImGui::SetNextItemWidth(-1.0f);
            const std::string combo_id = "##provider_option_" + option.name;
            if (ImGui::BeginCombo(combo_id.c_str(), preview.c_str())) {
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

            const std::string help = provider_option_help(option, prompt);
            if (!help.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", help.c_str());
                ImGui::PopStyleColor();
            }
        }
    }

    const ProviderWorkflow* selected_provider_workflow(
        const std::vector<ProviderWorkflow>& workflows,
        const std::string& provider_type
    ) {
        const std::string provider_key = normalized_provider_key(provider_type);
        for (const auto& workflow : workflows) {
            if (workflow.type == provider_type) {
                return &workflow;
            }
        }
        for (const auto& workflow : workflows) {
            const std::string workflow_type_key = normalized_provider_key(workflow.type);
            const std::string workflow_name_key = normalized_provider_key(workflow.name);
            if (!provider_key.empty() &&
                (workflow_type_key == provider_key ||
                 workflow_name_key == provider_key ||
                 workflow_type_key.find(provider_key) != std::string::npos ||
                 provider_key.find(workflow_type_key) != std::string::npos)) {
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

    void show_provider_rename_popup(ProvidersState& state) {
        const ProviderRenameSession session = state.rename_session_snapshot();
        if (!session.show_modal) {
            return;
        }

        const char* popup_name = "##providers_rename";
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
            ImGui::TextUnformatted("Rename Provider");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextWrapped("Rename the rclone remote used by Misty.");
            ImGui::Spacing();
            ImGui::TextWrapped("Current: %s", session.old_name.c_str());
            ImGui::PopStyleColor();

            char buffer[128] = {0};
            std::snprintf(buffer, sizeof(buffer), "%s", session.new_name.c_str());
            ImGui::SetNextItemWidth(-1.0f);
            if (session.in_flight) {
                ImGui::BeginDisabled();
            }
            if (ImGui::InputText("##provider_rename_input", buffer, sizeof(buffer))) {
                state.set_pending_rename_name(buffer);
            }
            if (session.in_flight) {
                ImGui::EndDisabled();
            }

            if (!session.validation_error.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.894f, 0.373f, 0.373f, 1.0f));
                ImGui::TextWrapped("%s", session.validation_error.c_str());
                ImGui::PopStyleColor();
            }

            ImGui::Spacing();
            const bool can_confirm = !session.in_flight && session.validation_error.empty();
            if (!can_confirm) {
                ImGui::BeginDisabled();
            }
            if (provider_teal_button(session.in_flight ? "Renaming..." : "Rename", ImVec2(210.0f, 40.0f))) {
                state.confirm_rename();
            }
            if (!can_confirm) {
                ImGui::EndDisabled();
            }

            ImGui::SameLine(0.0f, 12.0f);
            if (session.in_flight) {
                ImGui::BeginDisabled();
            }
            if (provider_outline_button("Cancel", ImVec2(210.0f, 40.0f))) {
                state.dismiss_active_dialog();
                ImGui::CloseCurrentPopup();
            }
            if (session.in_flight) {
                ImGui::EndDisabled();
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }

    void show_provider_details_popup(ProvidersState& state) {
        const ProviderDetailsSession session = state.details_session_snapshot();
        if (!session.show_modal) {
            return;
        }

        const char* popup_name = "##providers_details";
        if (!ImGui::IsPopupOpen(popup_name)) {
            ImGui::OpenPopup(popup_name);
        }

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(620.0f, 520.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(22.0f, 22.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.12f, 0.13f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

        if (ImGui::BeginPopupModal(popup_name, nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                       ImGuiWindowFlags_NoMove)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kText);
            ImGui::SetWindowFontScale(1.15f);
            ImGui::TextUnformatted("Provider Details");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextWrapped("%s", session.remote_name.c_str());
            if (!session.provider_type.empty()) {
                ImGui::TextWrapped("Type: %s", session.provider_type.c_str());
            }
            ImGui::PopStyleColor();

            ImGui::Spacing();
            if (session.in_flight) {
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextUnformatted("Loading details...");
                ImGui::PopStyleColor();
            } else if (!session.error.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.894f, 0.373f, 0.373f, 1.0f));
                ImGui::TextWrapped("%s", session.error.c_str());
                ImGui::PopStyleColor();
            }

            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.043f, 0.051f, 0.059f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
            if (ImGui::BeginChild("##provider_details_body", ImVec2(0.0f, 330.0f), true)) {
                const std::string about = pretty_json_or_text(session.about_json);
                const std::string config = pretty_json_or_text(session.config_json);
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::TextUnformatted("Storage");
                ImGui::PopStyleColor();
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", about.empty() ? "Storage details unavailable." : about.c_str());
                ImGui::PopStyleColor();
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::TextUnformatted("Config");
                ImGui::PopStyleColor();
                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", config.empty() ? "Config details unavailable." : config.c_str());
                ImGui::PopStyleColor();
            }
            ImGui::EndChild();
            ImGui::PopStyleColor(2);

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
