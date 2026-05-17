#include "panels/providers/providers_panel.h"

#include "imgui.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <optional>
#include <string>
#include <vector>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
        constexpr ImVec4 kError = ImVec4(0.95f, 0.49f, 0.49f, 1.0f);
        constexpr ImVec4 kTeal = ImVec4(0.02f, 0.71f, 0.74f, 1.0f);
        constexpr ImVec4 kTealHover = ImVec4(0.06f, 0.77f, 0.80f, 1.0f);
        constexpr ImVec4 kTealActive = ImVec4(0.01f, 0.60f, 0.63f, 1.0f);
        constexpr float kProviderModalWidth = 560.0f;
        constexpr float kProviderModalMaxHeightPct = 0.82f;
        constexpr float kProviderModalMinHeight = 320.0f;
        constexpr float kProviderModalFooterHeight = 64.0f;

        bool outline_button(const char* label, const ImVec2& size) {
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

        bool teal_button(const char* label, const ImVec2& size) {
            ImGui::PushStyleColor(ImGuiCol_Button, kTeal);
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kTealHover);
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, kTealActive);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.98f, 0.99f, 1.0f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
            const bool pressed = ImGui::Button(label, size);
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(4);
            return pressed;
        }

        std::optional<ProviderWorkflow> selected_workflow_for(
            const std::vector<ProviderWorkflow>& workflows,
            const std::string& provider_type
        ) {
            for (const auto& workflow : workflows) {
                if (workflow.type == provider_type) {
                    return workflow;
                }
            }
            return std::nullopt;
        }

        std::string parameter_value_for(const ActiveProviderConfigSession& session, const std::string& key) {
            const auto it = session.parameters.find(key);
            return it == session.parameters.end() ? std::string{} : it->second;
        }

        std::string choice_label_for(const ProviderChoice& choice) {
            if (!choice.help.empty()) {
                return choice.help;
            }
            return choice.value;
        }

        std::string preview_label_for(const ProviderOption& option, const std::string& value) {
            for (const auto& choice : option.choices) {
                if (choice.value == value) {
                    return choice_label_for(choice);
                }
            }
            return value;
        }

        void render_text_option_editor(ProvidersState& state, const ProviderOption& option, const std::string& value) {
            std::array<char, 512> buffer{};
            std::snprintf(buffer.data(), buffer.size(), "%s", value.c_str());

            ImGuiInputTextFlags flags = option.password ? ImGuiInputTextFlags_Password : ImGuiInputTextFlags_None;
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

        void render_choice_option_editor(ProvidersState& state, const ProviderOption& option, const std::string& value) {
            std::string current_value = value;
            if (current_value.empty() && !option.default_value.empty()) {
                current_value = option.default_value;
            }
            if (current_value.empty() && !option.choices.empty()) {
                current_value = option.choices.front().value;
            }

            const std::string preview =
                current_value.empty() ? "Select a value" : preview_label_for(option, current_value);
            const std::string label = option.required ? option.name + " *" : option.name;
            if (ImGui::BeginCombo(label.c_str(), preview.c_str())) {
                for (const auto& choice : option.choices) {
                    const bool selected = choice.value == current_value;
                    const std::string choice_label = choice_label_for(choice);
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

        void render_option_editor(ProvidersState& state, const ProviderOption& option, const ActiveProviderConfigSession& session) {
            const std::string value = parameter_value_for(session, option.name);
            if (!option.choices.empty()) {
                render_choice_option_editor(state, option, value);
                return;
            }
            render_text_option_editor(state, option, value);
        }

        void show_placeholder_popup(ProvidersState& state, bool open, const char* popup_name, const char* title) {
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
                if (outline_button("Close", ImVec2(-1.0f, 40.0f))) {
                    state.dismiss_active_dialog();
                    ImGui::CloseCurrentPopup();
                }
                ImGui::EndPopup();
            }

            ImGui::PopStyleColor(2);
            ImGui::PopStyleVar(2);
        }

        void show_disconnect_popup(ProvidersState& state, bool open) {
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
                if (teal_button("Disconnect", ImVec2(210.0f, 40.0f))) {
                    state.confirm_disconnect();
                }
                if (disconnect_in_flight) {
                    ImGui::EndDisabled();
                }

                ImGui::SameLine(0.0f, 12.0f);
                if (disconnect_in_flight) {
                    ImGui::BeginDisabled();
                }
                if (outline_button("Cancel", ImVec2(210.0f, 40.0f))) {
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

    void ProvidersPanel::show_provider_dialogs(ProvidersState& state) {
        const auto session = state.add_provider_session_snapshot();
        const auto workflows = state.workflows_snapshot();

        if (session.show_modal) {
            const char* popup_name = "##providers_add_provider";
            if (!ImGui::IsPopupOpen(popup_name)) {
                ImGui::OpenPopup(popup_name);
            }

            ImGuiViewport* viewport = ImGui::GetMainViewport();
            ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            const float max_modal_height = viewport->WorkSize.y * kProviderModalMaxHeightPct;
            ImGui::SetNextWindowSize(ImVec2(kProviderModalWidth, max_modal_height), ImGuiCond_Always);
            ImGui::SetNextWindowSizeConstraints(
                ImVec2(kProviderModalWidth, kProviderModalMinHeight),
                ImVec2(kProviderModalWidth, max_modal_height)
            );
            ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(22.0f, 22.0f));
            ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.12f, 0.13f, 0.15f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

            if (ImGui::BeginPopupModal(popup_name, nullptr,
                                       ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                           ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
                ImGui::PushStyleColor(ImGuiCol_Text, kText);
                ImGui::SetWindowFontScale(1.15f);
                ImGui::TextUnformatted("Add Provider");
                ImGui::SetWindowFontScale(1.0f);
                ImGui::PopStyleColor();

                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("Choose a provider, name the remote, and Misty will finish the browser sign-in flow for you.");
                ImGui::PopStyleColor();

                const float body_height = std::max(
                    120.0f,
                    ImGui::GetContentRegionAvail().y - kProviderModalFooterHeight
                );
                if (ImGui::BeginChild(
                        "##providers_add_provider_body",
                        ImVec2(0.0f, body_height),
                        false,
                        ImGuiWindowFlags_AlwaysVerticalScrollbar
                    )) {
                    if (workflows.empty()) {
                        ImGui::Spacing();
                        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                        ImGui::TextWrapped("Loading provider workflows from the local proxy...");
                        ImGui::PopStyleColor();
                    } else {
                        ImGui::Spacing();
                        ImGui::PushStyleColor(ImGuiCol_Text, kText);
                        ImGui::TextUnformatted("Provider");
                        ImGui::PopStyleColor();

                        const bool selecting_provider = session.current_step_kind.empty();
                        if (!selecting_provider) {
                            ImGui::BeginDisabled();
                        }
                        for (const auto& workflow : workflows) {
                            const bool selected = workflow.type == session.selected_provider_type;
                            const std::string label = workflow.name.empty() ? workflow.type : workflow.name;
                            if (ImGui::Selectable(label.c_str(), selected)) {
                                state.select_provider_type(workflow.type);
                            }
                            if (!workflow.description.empty()) {
                                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                                ImGui::TextWrapped("%s", workflow.description.c_str());
                                ImGui::PopStyleColor();
                            }
                            ImGui::Spacing();
                        }
                        if (!selecting_provider) {
                            ImGui::EndDisabled();
                        }

                        if (!session.selected_provider_type.empty()) {
                            ImGui::Separator();
                            ImGui::PushStyleColor(ImGuiCol_Text, kText);
                            ImGui::TextUnformatted("Remote Name");
                            ImGui::PopStyleColor();

                            std::array<char, 256> remote_name{};
                            std::snprintf(remote_name.data(), remote_name.size(), "%s", session.remote_name.c_str());
                            if (!selecting_provider) {
                                ImGui::BeginDisabled();
                            }
                            if (ImGui::InputText("##provider_remote_name", remote_name.data(), remote_name.size())) {
                                state.set_remote_name(remote_name.data());
                            }
                            if (!selecting_provider) {
                                ImGui::EndDisabled();
                            }
                        }

                        if (session.current_step_kind == "browser_auth") {
                            ImGui::Spacing();
                            ImGui::Separator();
                            ImGui::Spacing();

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
                                ImGui::Spacing();
                                if (outline_button("Open Browser Again", ImVec2(220.0f, 36.0f))) {
                                    state.reopen_browser_auth();
                                }
                            }

                            if (session.browser_launch_attempted && !session.browser_launch_succeeded) {
                                ImGui::Spacing();
                                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                                ImGui::TextWrapped("Misty could not reopen the sign-in page automatically. If your browser did not open, try the button above.");
                                ImGui::PopStyleColor();
                            }
                        } else if (session.current_step_kind == "post_auth_config" && session.current_option.has_value()) {
                            ImGui::Spacing();
                            ImGui::Separator();
                            ImGui::Spacing();

                            ImGui::PushStyleColor(ImGuiCol_Text, kText);
                            ImGui::TextUnformatted("Provider Settings");
                            ImGui::PopStyleColor();

                            if (!session.instructions.empty()) {
                                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                                ImGui::TextWrapped("%s", session.instructions.c_str());
                                ImGui::PopStyleColor();
                                ImGui::Spacing();
                            }

                            render_option_editor(state, *session.current_option, session);
                        } else if (!session.selected_provider_type.empty()) {
                            if (auto workflow = selected_workflow_for(workflows, session.selected_provider_type)) {
                                ImGui::Spacing();
                                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                                ImGui::TextWrapped("%s", workflow->description.c_str());
                                ImGui::PopStyleColor();
                            }
                        }
                    }

                    if (!session.inline_error.empty()) {
                        ImGui::Spacing();
                        ImGui::PushStyleColor(ImGuiCol_Text, kError);
                        ImGui::TextWrapped("%s", session.inline_error.c_str());
                        ImGui::PopStyleColor();
                    }
                }
                ImGui::EndChild();

                ImGui::Spacing();
                const bool busy = session.submit_in_flight || session.poll_in_flight;
                const bool awaiting_browser = session.current_step_kind == "browser_auth";
                const bool configuring_provider = session.current_step_kind == "post_auth_config";

                if (busy || awaiting_browser) {
                    ImGui::BeginDisabled();
                }
                const char* primary_label = configuring_provider ? "Continue" : "Create Provider";
                if (teal_button(primary_label, ImVec2(220.0f, 40.0f))) {
                    state.submit_add_provider();
                }
                if (busy || awaiting_browser) {
                    ImGui::EndDisabled();
                }

                ImGui::SameLine(0.0f, 12.0f);
                if (outline_button(awaiting_browser ? "Close" : "Cancel", ImVec2(220.0f, 40.0f))) {
                    state.dismiss_active_dialog();
                    ImGui::CloseCurrentPopup();
                }

                ImGui::EndPopup();
            }

            ImGui::PopStyleColor(2);
            ImGui::PopStyleVar(2);
        }

        bool show_rename = false;
        bool show_disconnect = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            show_rename = state.show_rename_modal;
            show_disconnect = state.show_disconnect_modal;
        }
        show_placeholder_popup(state, show_rename, "##providers_rename_placeholder", "Rename Provider");
        show_disconnect_popup(state, show_disconnect);
    }
}
