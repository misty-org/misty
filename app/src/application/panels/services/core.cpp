#include "services_panel.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/imgui_utils.h"

#include <cmath>

namespace misty::panel {

    const std::vector<ServicesPanel::ProviderInfo>& ServicesPanel::supported_providers() {
        static const std::vector<ProviderInfo> providers = {
            {"onedrive", "OneDrive"},
            {"drive",    "Google Drive"},
            {"dropbox",  "Dropbox"},
            {"s3",       "Amazon S3"},
            {"sftp",     "SFTP"},
        };
        return providers;
    }

    ServicesPanel::ServicesPanel(UIRegistry& registry)
        : registry_(registry) {
    }

    void ServicesPanel::render() {
        auto& state = registry_.get_state<ServicesState>("Services");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar;

        core::WithWindowStyle(ImVec4(0.18f, 0.18f, 0.18f, 1.0f), ImVec2(32.0f, 24.0f), [&]() {
        if (ImGui::Begin("ServicesPanel", nullptr, flags)) {
            show_header();
            ImGui::SameLine();
            {
                float avail = ImGui::GetContentRegionAvail().x;
                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + avail - 84.0f);
                ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.22f, 0.22f, 0.25f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.30f, 0.30f, 0.33f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
                ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
                bool refreshing = state.is_refreshing;
                if (refreshing) ImGui::BeginDisabled();
                if (ImGui::Button("Refresh", ImVec2(84.0f, 28.0f))) {
                    state.refresh_connections();
                }
                if (refreshing) ImGui::EndDisabled();
                ImGui::PopStyleVar();
                ImGui::PopStyleColor(3);
            }
            ImGui::Spacing();
            show_cloud_section(state);

            if (state.is_refreshing) {
                show_loading_overlay();
            }
            show_disconnect_confirm_modal(state);
            show_login_modal(state);
            show_config_flow_modal(state);
        }
        ImGui::End();
        });
    }

    void ServicesPanel::show_header() {
        ImGui::BeginGroup();
        core::WithFontScale(1.8f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Services");
        });
        core::ColoredText(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "Manage your cloud storage services.");
        ImGui::EndGroup();
    }

    void ServicesPanel::show_cloud_section(ServicesState& state) {
        ImGui::Spacing();

        // Show connected remotes as cards
        show_remote_cards(state);

        ImGui::Spacing();
        ImGui::Spacing();

        // "Add Account" buttons for each provider type
        show_add_account_section(state);

        // Error display
        {
            std::lock_guard<std::mutex> lock(state.mu);
            if (!state.error_msg.empty()) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                ImGui::TextWrapped("%s", state.error_msg.c_str());
                ImGui::PopStyleColor();
            }
        }
    }

    void ServicesPanel::show_remote_cards(ServicesState& state) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(kCardSpacing, kCardSpacing));

        std::vector<RemoteConnection> conns;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            conns.assign(state.connections.begin(), state.connections.end());
        }

        if (conns.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
            ImGui::Text("No cloud accounts connected. Add one below.");
            ImGui::PopStyleColor();
        }

        int cards_drawn = 0;
        for (const auto& conn : conns) {
            if (cards_drawn > 0) {
                float next_end = ImGui::GetItemRectMax().x - ImGui::GetWindowPos().x + kCardSpacing + kCardWidth;
                float window_width = ImGui::GetContentRegionAvail().x + ImGui::GetCursorPosX();
                if (next_end <= window_width) {
                    ImGui::SameLine(0.0f, kCardSpacing);
                }
            }
            show_remote_card(state, conn);
            cards_drawn++;
        }

        ImGui::PopStyleVar(2);
    }

    void ServicesPanel::show_remote_card(ServicesState& state, const RemoteConnection& conn) {
        ImGui::PushID(conn.name.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.15f, 1.0f));

        float card_height = 140.0f;
        if (ImGui::BeginChild("Card", ImVec2(kCardWidth, card_height), true)) {
            // Provider type label
            std::string type_label = conn.type;
            if (type_label == "drive") type_label = "Google Drive";
            else if (type_label == "onedrive") type_label = "OneDrive";
            else if (type_label == "dropbox") type_label = "Dropbox";
            else if (type_label == "s3") type_label = "Amazon S3";
            else if (type_label == "sftp") type_label = "SFTP";

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
            ImGui::Text("%s", type_label.c_str());
            ImGui::PopStyleColor();

            ImGui::Spacing();

            // Remote name
            core::WithFontScale(1.2f, [&]() {
                core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", conn.name.c_str());
            });

            ImGui::Spacing();

            // Status indicator
            ImVec4 status_color = conn.connected
                ? ImVec4(0.3f, 0.8f, 0.3f, 1.0f)
                : ImVec4(0.8f, 0.3f, 0.3f, 1.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, status_color);
            ImGui::Text("%s", conn.connected ? "Connected" : "Disconnected");
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Spacing();

            // Disconnect button. We only set the pending state here — the
            // modal opens itself from show_disconnect_confirm_modal(), which
            // runs outside this per-card PushID stack so the popup ID
            // resolves correctly. Calling OpenPopup from inside PushID
            // would register the popup under a different ID hash and
            // BeginPopupModal would never find it.
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.55f, 0.18f, 0.18f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered,  ImVec4(0.65f, 0.28f, 0.28f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,   ImVec4(0.45f, 0.12f, 0.12f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
            if (ImGui::Button("Disconnect", ImVec2(100.0f, 26.0f))) {
                pending_disconnect_remote_ = conn.name;
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);
        }
        ImGui::EndChild();

        ImGui::PopStyleColor();
        ImGui::PopStyleVar();
        ImGui::PopID();
    }

    void ServicesPanel::show_add_account_section(ServicesState& state) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
        ImGui::Text("Add Cloud Account:");
        ImGui::PopStyleColor();

        ImGui::Spacing();

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(16.0f, 8.0f));

        for (const auto& provider : supported_providers()) {
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.22f, 0.22f, 0.25f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered,  ImVec4(0.30f, 0.30f, 0.33f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,   ImVec4(0.18f, 0.18f, 0.20f, 1.0f));

            std::string label = "+ " + provider.display_name;
            if (ImGui::Button(label.c_str(), ImVec2(0, 34.0f))) {
                state.login_provider_type = provider.type;
                state.show_login_modal = true;
            }
            ImGui::PopStyleColor(3);
            ImGui::SameLine(0.0f, 8.0f);
        }
        ImGui::NewLine();

        ImGui::PopStyleVar(2);
    }

    void ServicesPanel::show_login_modal(ServicesState& state) {
        if (!state.show_login_modal) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(400.0f, 0.0f), ImGuiCond_Always);

        ImGui::PushStyleColor(ImGuiCol_PopupBg,  ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border,   ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(24.0f, 24.0f));

        ImGui::OpenPopup("##add_remote");

        if (ImGui::BeginPopupModal("##add_remote", nullptr,
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {

            float w = ImGui::GetContentRegionAvail().x;

            // Title
            std::string type_display = state.login_provider_type;
            for (const auto& p : supported_providers()) {
                if (p.type == state.login_provider_type) {
                    type_display = p.display_name;
                    break;
                }
            }

            core::WithFontScale(1.3f, [&]() {
                std::string title = "Add " + type_display;
                float title_w = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - title_w) * 0.5f);
                core::ColoredText(ImVec4(0.9f, 0.9f, 0.9f, 1.0f), "%s", title.c_str());
            });

            ImGui::Spacing();
            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::TextWrapped(
                "A remote name will be generated automatically. "
                "Click Connect to start the authentication flow in your browser.");
            ImGui::PopStyleColor();

            // Error display
            if (!state.auth_error.empty()) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                ImGui::TextWrapped("%s", state.auth_error.c_str());
                ImGui::PopStyleColor();
            }

            // Success display
            if (!state.success_msg.empty()) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.4f, 0.8f, 0.4f, 1.0f));
                ImGui::TextWrapped("%s", state.success_msg.c_str());
                ImGui::PopStyleColor();
            }

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float half_w = (w - 8.0f) * 0.5f;
            bool cancel_shortcut = core::CommandManager::get().matches("modal.cancel");

            // Cancel
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.22f, 0.22f, 0.25f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.30f, 0.30f, 0.33f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            if (ImGui::Button("Cancel", ImVec2(half_w, 36.0f)) || cancel_shortcut) {
                state.show_login_modal = false;
                state.auth_error.clear();
                state.success_msg.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);

            ImGui::SameLine(0, 8.0f);

            // Connect
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.20f, 0.40f, 0.65f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.25f, 0.50f, 0.75f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.15f, 0.35f, 0.55f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            if (ImGui::Button("Connect", ImVec2(half_w, 36.0f))) {
                // Generate a remote name: type-timestamp
                auto now = std::chrono::system_clock::now();
                auto epoch = std::chrono::duration_cast<std::chrono::seconds>(
                    now.time_since_epoch()).count();
                std::string remote_name = state.login_provider_type + "-" + std::to_string(epoch);
                // Close the login picker and hand off to the interactive
                // step-by-step config flow modal.
                state.show_login_modal = false;
                state.start_remote_config(state.login_provider_type, remote_name);
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
    }

    void ServicesPanel::show_loading_overlay() {
        // Sprite sheet: 2560x1280, 10 cols x 5 rows = 50 frames, 256x256 per frame
        static constexpr int   COLS        = 10;
        static constexpr int   ROWS        = 5;
        static constexpr int   TOTAL       = COLS * ROWS;
        static constexpr float FRAME_RATE  = 20.0f;
        static constexpr float SPRITE_SIZE = 128.0f;

        auto& sprite = core::AssetManager::get().get_image_texture("assets/misty_sprite.png");

        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 p  = ImGui::GetWindowPos();
        ImVec2 sz = ImGui::GetWindowSize();

        dl->AddRectFilled(p, ImVec2(p.x + sz.x, p.y + sz.y), IM_COL32(15, 15, 18, 160));

        int frame = static_cast<int>(ImGui::GetTime() * FRAME_RATE) % TOTAL;
        int col   = frame % COLS;
        int row   = frame / COLS;

        float uv_w = 1.0f / COLS;
        float uv_h = 1.0f / ROWS;
        ImVec2 uv0(col * uv_w,        row * uv_h);
        ImVec2 uv1((col + 1) * uv_w,  (row + 1) * uv_h);

        float t    = static_cast<float>(ImGui::GetTime());
        float bob  = std::sin(t * 3.0f) * 6.0f;

        float cx   = p.x + sz.x * 0.5f;
        float cy   = p.y + sz.y * 0.5f + bob;
        float half = SPRITE_SIZE * 0.5f;

        dl->AddImage(
            (ImTextureID)(intptr_t)sprite.id,
            ImVec2(cx - half, cy - half),
            ImVec2(cx + half, cy + half),
            uv0, uv1
        );
    }

    void ServicesPanel::show_config_flow_modal(ServicesState& state) {
        // Snapshot under lock so the modal renders consistent state even if
        // a worker callback fires mid-frame.
        bool open;
        bool in_flight;
        ServicesState::ConfigStepKind kind;
        std::string remote_name;
        std::string question_help;
        std::string question_name;
        std::string error_msg;
        std::string warning_msg;
        std::vector<ServicesState::ConfigChoice> choices;
        std::string default_value;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            open          = state.config_modal_open;
            in_flight     = state.config_in_flight;
            kind          = state.config_kind;
            remote_name   = state.config_remote_name;
            question_help = state.config_question_help;
            question_name = state.config_question_name;
            error_msg     = state.config_error;
            warning_msg   = state.config_warning;
            choices       = state.config_choices;
            default_value = state.config_default;
        }

        if (!open) return;

        // If the flow finished, refresh connections and dismiss after a tick.
        if (kind == ServicesState::ConfigStepKind::DONE && !in_flight) {
            state.refresh_connections();
            std::lock_guard<std::mutex> lock(state.mu);
            state.config_modal_open = false;
            state.config_kind = ServicesState::ConfigStepKind::NONE;
            return;
        }

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(480.0f, 0.0f), ImGuiCond_Always);

        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border,  ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(24.0f, 24.0f));

        ImGui::OpenPopup("##remote_config_flow");

        if (ImGui::BeginPopupModal("##remote_config_flow", nullptr,
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {

            float w = ImGui::GetContentRegionAvail().x;

            // Title
            core::WithFontScale(1.3f, [&]() {
                std::string title = "Configure " + remote_name;
                float tw = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - tw) * 0.5f);
                core::ColoredText(ImVec4(0.9f, 0.9f, 0.9f, 1.0f), "%s", title.c_str());
            });
            ImGui::Spacing();
            ImGui::Spacing();

            // Spinner while we're waiting for the proxy
            if (in_flight) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
                ImGui::TextWrapped("Working… If a browser opened, complete the sign-in there.");
                ImGui::PopStyleColor();
            } else {
                // Question text
                if (!question_help.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
                    ImGui::TextWrapped("%s", question_help.c_str());
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }

                // Render based on step kind
                bool submitted = false;
                std::string result_value;

                switch (kind) {
                    case ServicesState::ConfigStepKind::CONFIRM: {
                        float half = (w - 8.0f) * 0.5f;
                        if (ImGui::Button("Yes", ImVec2(half, 32.0f))) {
                            submitted = true; result_value = "true";
                        }
                        ImGui::SameLine(0, 8.0f);
                        if (ImGui::Button("No", ImVec2(half, 32.0f))) {
                            submitted = true; result_value = "false";
                        }
                        break;
                    }
                    case ServicesState::ConfigStepKind::CHOOSE:
                    case ServicesState::ConfigStepKind::SUGGEST: {
                        // Vertical list of buttons. Default is highlighted.
                        for (const auto& c : choices) {
                            ImVec4 bg = (c.value == default_value)
                                ? ImVec4(0.20f, 0.40f, 0.65f, 1.0f)
                                : ImVec4(0.22f, 0.22f, 0.25f, 1.0f);
                            ImGui::PushStyleColor(ImGuiCol_Button,        bg);
                            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.30f, 0.46f, 0.70f, 1.0f));
                            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.18f, 0.36f, 0.56f, 1.0f));
                            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
                            std::string label = c.value;
                            if (!c.help.empty()) {
                                // First non-empty line of help becomes the subtitle
                                std::string h = c.help;
                                size_t nl = h.find('\n');
                                if (nl != std::string::npos) h = h.substr(0, nl);
                                label += "  —  " + h;
                            }
                            if (ImGui::Button(label.c_str(), ImVec2(w, 28.0f))) {
                                submitted = true; result_value = c.value;
                            }
                            ImGui::PopStyleVar();
                            ImGui::PopStyleColor(3);
                        }
                        // For SUGGEST, also allow free text below
                        if (kind == ServicesState::ConfigStepKind::SUGGEST) {
                            ImGui::Spacing();
                            ImGui::PushItemWidth(w);
                            ImGui::InputText("##config_input", state.config_input_buf,
                                             sizeof(state.config_input_buf));
                            ImGui::PopItemWidth();
                            if (ImGui::Button("Submit custom value", ImVec2(w, 32.0f))) {
                                submitted = true;
                                result_value = state.config_input_buf;
                            }
                        }
                        break;
                    }
                    case ServicesState::ConfigStepKind::INPUT: {
                        ImGui::PushItemWidth(w);
                        ImGui::InputText("##config_input", state.config_input_buf,
                                         sizeof(state.config_input_buf));
                        ImGui::PopItemWidth();
                        ImGui::Spacing();
                        if (ImGui::Button("Continue", ImVec2(w, 32.0f))) {
                            submitted = true;
                            result_value = state.config_input_buf;
                        }
                        break;
                    }
                    default:
                        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
                        ImGui::Text("Waiting for next step…");
                        ImGui::PopStyleColor();
                        break;
                }

                if (submitted) {
                    state.continue_remote_config(result_value);
                }
            }

            if (!warning_msg.empty()) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.7f, 0.3f, 1.0f));
                ImGui::TextWrapped("%s", warning_msg.c_str());
                ImGui::PopStyleColor();
            }
            if (!error_msg.empty()) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                ImGui::TextWrapped("%s", error_msg.c_str());
                ImGui::PopStyleColor();
            }

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.22f, 0.22f, 0.25f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.30f, 0.30f, 0.33f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            if (ImGui::Button("Cancel", ImVec2(w, 32.0f))) {
                state.cancel_remote_config();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
    }

    void ServicesPanel::show_disconnect_confirm_modal(ServicesState& state) {
        if (pending_disconnect_remote_.empty()) return;

        // Open the popup from here (no PushID block in scope) so the popup
        // ID stack matches the BeginPopupModal call below. Idempotent — safe
        // to call every frame; ImGui no-ops if it's already open.
        if (!ImGui::IsPopupOpen("##confirm_disconnect")) {
            ImGui::OpenPopup("##confirm_disconnect");
        }

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(320.0f, 0.0f), ImGuiCond_Always);

        ImGui::PushStyleColor(ImGuiCol_PopupBg,  ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border,   ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(24.0f, 24.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,    ImVec2(0.0f,  10.0f));

        if (ImGui::BeginPopupModal("##confirm_disconnect", nullptr,
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {

            float w = ImGui::GetContentRegionAvail().x;

            ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
            const char* title = "Disconnect account?";
            ImGui::SetCursorPosX((w - ImGui::CalcTextSize(title).x) * 0.5f);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.90f, 0.90f, 1.0f));
            ImGui::TextUnformatted(title);
            ImGui::PopStyleColor();
            ImGui::PopFont();

            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
            ImGui::TextWrapped(
                "This will remove \"%s\" from Misty. "
                "Your files in the cloud will not be affected.",
                pending_disconnect_remote_.c_str());
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float half_w = (w - 8.0f) * 0.5f;
            bool cancel_shortcut = core::CommandManager::get().matches("modal.cancel");
            bool confirm_shortcut = core::CommandManager::get().matches("modal.confirm");

            // Cancel
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.22f, 0.22f, 0.25f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.30f, 0.30f, 0.33f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.18f, 0.18f, 0.20f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            if (ImGui::Button("Cancel", ImVec2(half_w, 36.0f)) || cancel_shortcut) {
                pending_disconnect_remote_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);

            ImGui::SameLine(0, 8.0f);

            // Disconnect (red)
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.55f, 0.18f, 0.18f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.28f, 0.28f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.45f, 0.12f, 0.12f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            if (ImGui::Button("Disconnect", ImVec2(half_w, 36.0f)) || confirm_shortcut) {
                state.disconnect_remote(pending_disconnect_remote_);
                pending_disconnect_remote_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(3);

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(2);
    }

}
