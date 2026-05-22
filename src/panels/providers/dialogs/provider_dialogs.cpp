#include "panels/providers/providers_panel.h"

#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/dialogs/provider_dialogs_util.h"
#include "panels/providers/layout/providers_layout_util.h"
#include "imgui.h"

namespace misty::panel {
    namespace {
        constexpr ImVec4 kBorder = ImVec4(0.24f, 0.27f, 0.30f, 1.0f);
        constexpr ImVec4 kText = ImVec4(0.94f, 0.95f, 0.97f, 1.0f);
        constexpr ImVec4 kMuted = ImVec4(0.62f, 0.66f, 0.70f, 1.0f);
        constexpr ImVec4 kError = ImVec4(0.95f, 0.49f, 0.49f, 1.0f);
        constexpr float kProviderModalWidth = 560.0f;
        constexpr float kProviderModalMaxHeightPct = 0.82f;
        constexpr float kProviderModalMinHeight = 320.0f;
        constexpr float kProviderModalFooterHeight = 64.0f;
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
            const bool reconnect_mode = session.reconnect_mode;
            const bool repair_mode = session.repair_mode;

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
                ImGui::TextUnformatted(dialog_text.title.c_str());
                ImGui::SetWindowFontScale(1.0f);
                ImGui::PopStyleColor();

                ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                ImGui::TextWrapped("%s", dialog_text.intro.c_str());
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
                        ImGui::TextUnformatted(reconnect_mode ? "Provider" : "Provider");
                        ImGui::PopStyleColor();

                        const bool locked_existing_provider = reconnect_mode || repair_mode;
                        const bool selecting_provider = session.current_step_kind.empty() && !locked_existing_provider;
                        if (locked_existing_provider) {
                            std::string provider_label = session.selected_provider_type;
                            if (const ProviderWorkflow* workflow = selected_provider_workflow(workflows, session.selected_provider_type)) {
                                provider_label = workflow->name.empty() ? workflow->type : workflow->name;
                            }
                            ImGui::PushStyleColor(ImGuiCol_Text, kText);
                            ImGui::TextWrapped("%s", provider_label.c_str());
                            ImGui::PopStyleColor();

                            ImGui::Spacing();
                            ImGui::Separator();
                            ImGui::PushStyleColor(ImGuiCol_Text, kText);
                            ImGui::TextUnformatted("Remote Name");
                            ImGui::PopStyleColor();
                            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
                            ImGui::TextWrapped("%s", session.remote_name.c_str());
                            ImGui::PopStyleColor();
                        } else {
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
                        }

                        if (!locked_existing_provider && !session.selected_provider_type.empty()) {
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
                                if (provider_outline_button("Open Browser Again", ImVec2(220.0f, 36.0f))) {
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

                            render_provider_option_editor(state, *session.current_option, session);
                        } else if (!session.selected_provider_type.empty()) {
                            if (const ProviderWorkflow* workflow = selected_provider_workflow(workflows, session.selected_provider_type)) {
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
                const char* primary_label = configuring_provider
                    ? "Continue"
                    : dialog_text.primary_button_label.c_str();
                if (provider_teal_button(primary_label, ImVec2(220.0f, 40.0f))) {
                    state.submit_add_provider();
                }
                if (busy || awaiting_browser) {
                    ImGui::EndDisabled();
                }

                ImGui::SameLine(0.0f, 12.0f);
                if (provider_outline_button(awaiting_browser ? "Close" : "Cancel", ImVec2(220.0f, 40.0f))) {
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
        show_provider_placeholder_popup(state, show_rename, "##providers_rename_placeholder", "Rename Provider");
        show_provider_disconnect_popup(state, show_disconnect);
    }
}
