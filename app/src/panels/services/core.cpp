#include "services_panel.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/imgui_utils.h"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace misty::panel {

    namespace {
        constexpr float kRemoteCardHeight = 124.0f;

        std::string display_name_for_provider(const std::string& type) {
            if (type == "drive") return "Google Drive";
            if (type == "onedrive") return "OneDrive";
            if (type == "dropbox") return "Dropbox";
            if (type == "s3") return "Amazon S3";
            if (type == "sftp") return "SFTP";
            return type;
        }

        int compute_columns(float available_width, float min_item_width, float spacing) {
            if (available_width <= min_item_width) return 1;
            return std::max(1, static_cast<int>((available_width + spacing) / (min_item_width + spacing)));
        }

        float compute_item_width(float available_width, int columns, float spacing) {
            if (columns <= 1) return available_width;
            return (available_width - spacing * static_cast<float>(columns - 1)) / static_cast<float>(columns);
        }

        std::string ellipsize_text(const std::string& text, float max_width) {
            if (text.empty()) return text;
            if (ImGui::CalcTextSize(text.c_str()).x <= max_width) return text;

            static constexpr const char* kEllipsis = "...";
            std::string truncated = text;
            while (!truncated.empty()) {
                std::string candidate = truncated + kEllipsis;
                if (ImGui::CalcTextSize(candidate.c_str()).x <= max_width) {
                    return candidate;
                }
                truncated.pop_back();
            }
            return kEllipsis;
        }

        std::string lowercase_copy(std::string value) {
            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return value;
        }

        bool matches_remote_filter(const RemoteConnection& conn, const std::string& query) {
            if (query.empty()) return true;

            const std::string normalized_query = lowercase_copy(query);
            const std::string haystack = lowercase_copy(
                conn.name + " " + conn.alias + " " + display_name_for_provider(conn.type) + " " + conn.display_name);
            return haystack.find(normalized_query) != std::string::npos;
        }

        bool matches_provider_filter(const std::string& provider_type,
                                     const std::string& provider_display_name,
                                     const std::string& query) {
            if (query.empty()) return true;

            const std::string normalized_query = lowercase_copy(query);
            const std::string haystack = lowercase_copy(provider_display_name + " " + provider_type);
            return haystack.find(normalized_query) != std::string::npos;
        }

        core::ButtonColors neutral_button_theme() {
            core::ButtonColors colors;
            colors.button = ImVec4(0.23f, 0.23f, 0.24f, 1.0f);
            colors.hovered = ImVec4(0.29f, 0.29f, 0.31f, 1.0f);
            colors.active = ImVec4(0.19f, 0.19f, 0.20f, 1.0f);
            colors.text = ImVec4(0.94f, 0.94f, 0.95f, 1.0f);
            colors.rounding = 8.0f;
            return colors;
        }
    } // namespace

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
            ImGuiWindowFlags_NoCollapse;

        core::WithWindowStyle(ImVec4(0.18f, 0.18f, 0.18f, 1.0f), ImVec2(32.0f, 24.0f), [&]() {
        if (ImGui::Begin("ServicesPanel", nullptr, flags)) {
            show_header(state);

            std::string error_msg;
            std::string success_msg;
            {
                std::lock_guard<std::mutex> lock(state.mu);
                error_msg = state.error_msg;
                success_msg = state.success_msg;
            }

            if (!error_msg.empty()) {
                ImGui::Spacing();
                core::ColoredText(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%s", error_msg.c_str());
            }

            if (!success_msg.empty()) {
                ImGui::Spacing();
                core::ColoredText(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%s", success_msg.c_str());
            }

            ImGui::Spacing();
            show_add_account_section(state);
            ImGui::Spacing();
            show_cloud_section(state);

            if (state.is_refreshing) {
                show_loading_overlay();
            }
            show_disconnect_confirm_modal(state);
            show_rename_remote_modal(state);
            show_login_modal(state);
            show_config_flow_modal(state);
        }
        ImGui::End();
        });
    }

    void ServicesPanel::show_header(ServicesState& state) {
        size_t connection_count = 0;
        bool is_refreshing = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            connection_count = state.connections.size();
            is_refreshing = state.is_refreshing;
        }

        ImGui::BeginGroup();
        core::WithFontScale(1.8f, []() {
            core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Services");
        });
        core::ColoredText(ImVec4(0.70f, 0.70f, 0.70f, 1.0f),
                          "Search your connected remotes and add new services from a single chooser.");
        ImGui::Spacing();
        core::ColoredText(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%zu connected", connection_count);
        ImGui::SameLine(0.0f, 18.0f);
        core::ColoredText(ImVec4(0.58f, 0.58f, 0.62f, 1.0f), "%zu providers", supported_providers().size());
        ImGui::SameLine(0.0f, 18.0f);
        core::ColoredText(ImVec4(0.66f, 0.66f, 0.69f, 1.0f),
                          "%s", is_refreshing ? "Refreshing remotes" : "Ready");
        ImGui::EndGroup();

        ImGui::SameLine();
        const float refresh_width = 112.0f;
        ImGui::Dummy(ImVec2(std::max(0.0f, ImGui::GetContentRegionAvail().x - refresh_width), 0.0f));
        ImGui::SameLine();
        if (is_refreshing) ImGui::BeginDisabled();
        if (core::StyledButton("Refresh", ImVec2(refresh_width, 30.0f), core::ButtonTheme::Primary())) {
            state.refresh_connections();
        }
        if (is_refreshing) ImGui::EndDisabled();
    }

    void ServicesPanel::show_cloud_section(ServicesState& state) {
        size_t connection_count = 0;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            connection_count = state.connections.size();
        }

        core::WithFontScale(1.2f, []() {
            core::ColoredText(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "Connected Services");
        });
        core::ColoredText(ImVec4(0.56f, 0.56f, 0.60f, 1.0f),
                          connection_count == 0
                              ? "Add a service to start browsing, syncing, and backing up remote files."
                              : "Use search to filter the current remotes list.");
        ImGui::Spacing();
        show_remote_cards(state);
    }

    void ServicesPanel::show_remote_cards(ServicesState& state) {
        std::vector<RemoteConnection> conns;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            conns.assign(state.connections.begin(), state.connections.end());
        }

        std::vector<RemoteConnection> filtered_conns;
        filtered_conns.reserve(conns.size());
        for (const auto& conn : conns) {
            if (matches_remote_filter(conn, remote_search_buf_)) {
                filtered_conns.push_back(conn);
            }
        }

        if (conns.empty()) {
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.16f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
            if (ImGui::BeginChild("##services_empty_state", ImVec2(0.0f, 118.0f), true,
                                  ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
                core::WithFontScale(1.1f, []() {
                    core::ColoredText(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "No services connected yet");
                });
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.60f, 0.60f, 0.64f, 1.0f));
                ImGui::TextWrapped("Use Add Service to connect a provider. New remotes appear here immediately and can be filtered from the search bar.");
                ImGui::PopStyleColor();
            }
            ImGui::EndChild();
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor();
            return;
        }

        if (filtered_conns.empty()) {
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.16f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 18.0f));
            if (ImGui::BeginChild("##services_filtered_empty", ImVec2(0.0f, 92.0f), true,
                                  ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
                core::ColoredText(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "No matching services");
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.60f, 0.60f, 0.64f, 1.0f));
                ImGui::TextWrapped("Try a different search term or clear the filter to see every connected remote.");
                ImGui::PopStyleColor();
            }
            ImGui::EndChild();
            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor();
            return;
        }

        float available_width = ImGui::GetContentRegionAvail().x;
        int columns = compute_columns(available_width, kMinCardWidth, kCardSpacing);
        float card_width = compute_item_width(available_width, columns, kCardSpacing);

        for (size_t index = 0; index < filtered_conns.size(); ++index) {
            if (index > 0 && (index % static_cast<size_t>(columns)) != 0) {
                ImGui::SameLine(0.0f, kCardSpacing);
            }
            show_remote_card(state, filtered_conns[index], card_width);
        }
    }

    void ServicesPanel::show_remote_card(ServicesState& state, const RemoteConnection& conn, float card_width) {
        (void) state;
        ImGui::PushID(conn.name.c_str());
        const std::string provider_name = display_name_for_provider(conn.type);
        const std::string account_name = conn.alias.empty() ? conn.name : conn.alias;
        const std::string status_label = conn.connected ? "Connected" : "Disconnected";
        const ImVec4 status_color = ImVec4(0.74f, 0.74f, 0.76f, 1.0f);

        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 12.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.15f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));
        if (ImGui::BeginChild("##service_card", ImVec2(card_width, kRemoteCardHeight), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            if (ImGui::BeginTable("##service_card_header", 2,
                                  ImGuiTableFlags_SizingStretchSame | ImGuiTableFlags_NoSavedSettings)) {
                ImGui::TableSetupColumn("provider", ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("status", ImGuiTableColumnFlags_WidthFixed, 96.0f);
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                core::ColoredText(ImVec4(0.72f, 0.72f, 0.75f, 1.0f), "%s", provider_name.c_str());
                ImGui::TableNextColumn();
                core::ColoredText(status_color, "%s", status_label.c_str());
                ImGui::EndTable();
            }

            core::WithFontScale(1.12f, [&]() {
                core::ColoredText(ImVec4(0.97f, 0.97f, 0.98f, 1.0f), "%s",
                                  ellipsize_text(account_name, std::max(40.0f, card_width - 32.0f)).c_str());
            });
            ImGui::Spacing();
            core::ColoredText(ImVec4(0.60f, 0.60f, 0.64f, 1.0f), "Available in Files and Vault");
            ImGui::Spacing();

            if (ImGui::BeginTable("##service_card_actions", 2,
                                  ImGuiTableFlags_SizingStretchSame | ImGuiTableFlags_NoSavedSettings)) {
                ImGui::TableSetupColumn("rename", ImGuiTableColumnFlags_WidthFixed, 96.0f);
                ImGui::TableSetupColumn("disconnect", ImGuiTableColumnFlags_WidthFixed, 104.0f);
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                if (core::StyledButton("Rename", ImVec2(96.0f, 26.0f), neutral_button_theme())) {
                    pending_rename_remote_ = conn.name;
                    std::memset(rename_remote_buf_, 0, sizeof(rename_remote_buf_));
                    if (!conn.alias.empty() && conn.alias.size() < sizeof(rename_remote_buf_)) {
                        std::memcpy(rename_remote_buf_, conn.alias.c_str(), conn.alias.size() + 1);
                    }
                }
                ImGui::TableNextColumn();
                if (core::StyledButton("Disconnect", ImVec2(104.0f, 26.0f), neutral_button_theme())) {
                    pending_disconnect_remote_ = conn.name;
                }
                ImGui::EndTable();
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
        ImGui::PopID();
    }

    void ServicesPanel::show_add_account_section(ServicesState& state) {
        const float add_button_width = 136.0f;
        ImGui::PushItemWidth(std::max(180.0f, ImGui::GetContentRegionAvail().x - add_button_width - kCardSpacing));
        ImGui::InputTextWithHint("##services_search", "Search connected services", remote_search_buf_,
                                 sizeof(remote_search_buf_));
        ImGui::PopItemWidth();
        ImGui::SameLine(0.0f, kCardSpacing);
        if (core::StyledButton("Add Service", ImVec2(add_button_width, 0.0f), core::ButtonTheme::Primary())) {
            provider_search_buf_[0] = '\0';
            state.show_login_modal = true;
        }
    }

    void ServicesPanel::show_login_modal(ServicesState& state) {
        if (!state.show_login_modal) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(520.0f, 500.0f), ImGuiCond_Always);

        ImGui::PushStyleColor(ImGuiCol_PopupBg,  ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border,   ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(24.0f, 24.0f));

        ImGui::OpenPopup("##add_remote");

        if (ImGui::BeginPopupModal("##add_remote", nullptr,
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoMove)) {

            float w = ImGui::GetContentRegionAvail().x;

            core::WithFontScale(1.3f, [&]() {
                std::string title = "Add Service";
                float title_w = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - title_w) * 0.5f);
                core::ColoredText(ImVec4(0.9f, 0.9f, 0.9f, 1.0f), "%s", title.c_str());
            });

            ImGui::Spacing();
            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::TextWrapped(
                "Choose a provider to create a new remote. A remote name is generated automatically and the setup flow starts immediately.");
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::PushItemWidth(core::AvailableWidth());
            ImGui::InputTextWithHint("##provider_search", "Search providers", provider_search_buf_,
                                     sizeof(provider_search_buf_));
            ImGui::PopItemWidth();

            size_t visible_count = 0;
            for (const auto& provider : supported_providers()) {
                if (!matches_provider_filter(provider.type, provider.display_name, provider_search_buf_)) {
                    continue;
                }

                ++visible_count;
                ImGui::Spacing();
                if (core::StyledButton(provider.display_name.c_str(), ImVec2(core::FillWidth(), 34.0f), neutral_button_theme())) {
                    auto now = std::chrono::system_clock::now();
                    auto epoch = std::chrono::duration_cast<std::chrono::seconds>(
                        now.time_since_epoch()).count();
                    std::string remote_name = provider.type + "-" + std::to_string(epoch);
                    state.login_provider_type = provider.type;
                    state.show_login_modal = false;
                    provider_search_buf_[0] = '\0';
                    state.start_remote_config(provider.type, remote_name);
                    ImGui::CloseCurrentPopup();
                }
            }

            if (visible_count == 0) {
                ImGui::Spacing();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.72f, 1.0f));
                ImGui::TextWrapped("No providers match that search.");
                ImGui::PopStyleColor();
            }

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            bool cancel_shortcut = core::CommandManager::get().matches("modal.cancel");
            if (core::StyledButton("Cancel", ImVec2(w, 36.0f), neutral_button_theme()) || cancel_shortcut) {
                state.show_login_modal = false;
                provider_search_buf_[0] = '\0';
                state.auth_error.clear();
                state.success_msg.clear();
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
    }

    void ServicesPanel::show_loading_overlay() {
        ImVec2 p  = ImGui::GetWindowPos();
        ImVec2 sz = ImGui::GetWindowSize();
        core::DrawMistyLoadingAnimation(p, ImVec2(p.x + sz.x, p.y + sz.y));
    }

    void ServicesPanel::show_config_flow_modal(ServicesState& state) {
        // Snapshot under lock so the modal renders consistent state even if
        // a worker callback fires mid-frame.
        bool open;
        bool in_flight;
        ServicesState::ConfigStepKind kind;
        std::string remote_name;
        std::string provider_type;
        std::string question_help;
        std::string question_name;
        bool question_is_password;
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
            provider_type = state.config_provider_type;
            question_help = state.config_question_help;
            question_name = state.config_question_name;
            question_is_password = state.config_question_password;
            error_msg     = state.config_error;
            warning_msg   = state.config_warning;
            choices       = state.config_choices;
            default_value = state.config_default;
        }

        if (!open) return;

        // If the flow finished, refresh connections and dismiss after a tick.
        if (kind == ServicesState::ConfigStepKind::DONE && !in_flight) {
            if (state.get_remote_alias(remote_name).empty()) {
                pending_rename_remote_ = remote_name;
                std::memset(rename_remote_buf_, 0, sizeof(rename_remote_buf_));
            }
            state.refresh_connections();
            std::lock_guard<std::mutex> lock(state.mu);
            state.config_modal_open = false;
            state.config_kind = ServicesState::ConfigStepKind::NONE;
            return;
        }

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(520.0f, 430.0f), ImGuiCond_Always);

        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border,  ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(24.0f, 24.0f));

        ImGui::OpenPopup("##remote_config_flow");

        if (ImGui::BeginPopupModal("##remote_config_flow", nullptr,
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoMove)) {

            float w = ImGui::GetContentRegionAvail().x;

            // Title
            core::WithFontScale(1.3f, [&]() {
                std::string provider_name = display_name_for_provider(provider_type);
                std::string title = provider_name.empty() ? "Configure Service" : "Configure " + provider_name;
                float tw = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - tw) * 0.5f);
                core::ColoredText(ImVec4(0.9f, 0.9f, 0.9f, 1.0f), "%s", title.c_str());
            });
            ImGui::Spacing();
            if (!remote_name.empty() && remote_name.find('@') != std::string::npos) {
                float subtitle_w = ImGui::CalcTextSize(remote_name.c_str()).x;
                ImGui::SetCursorPosX((w - subtitle_w) * 0.5f);
                core::ColoredText(ImVec4(0.62f, 0.62f, 0.66f, 1.0f), "%s", remote_name.c_str());
            }
            ImGui::Spacing();

            bool submitted = false;
            std::string result_value;

            if (ImGui::BeginChild("##config_flow_body", ImVec2(0.0f, 270.0f), false)) {
                // Spinner while we're waiting for the proxy
                if (in_flight) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
                    ImGui::TextWrapped("Working… If a browser opened, complete the sign-in there.");
                    ImGui::PopStyleColor();
                } else {
                    if (!question_name.empty()) {
                        core::ColoredText(ImVec4(0.92f, 0.92f, 0.93f, 1.0f), "%s", question_name.c_str());
                        ImGui::Spacing();
                    }

                    if (!question_help.empty()) {
                        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
                        ImGui::TextWrapped("%s", question_help.c_str());
                        ImGui::PopStyleColor();
                        ImGui::Spacing();
                    }

                    switch (kind) {
                        case ServicesState::ConfigStepKind::CONFIRM: {
                            float half = (w - 16.0f - 8.0f) * 0.5f;
                            if (core::StyledButton("Yes", ImVec2(half, 32.0f), neutral_button_theme())) {
                                submitted = true; result_value = "true";
                            }
                            ImGui::SameLine(0, 8.0f);
                            if (core::StyledButton("No", ImVec2(half, 32.0f), neutral_button_theme())) {
                                submitted = true; result_value = "false";
                            }
                            break;
                        }
                        case ServicesState::ConfigStepKind::CHOOSE:
                        case ServicesState::ConfigStepKind::SUGGEST: {
                            for (const auto& c : choices) {
                                std::string label = c.label.empty() ? c.value : c.label;
                                if (!c.help.empty()) {
                                    std::string h = c.help;
                                    size_t nl = h.find('\n');
                                    if (nl != std::string::npos) h = h.substr(0, nl);
                                    label += "  -  " + h;
                                }
                                core::ButtonColors theme = neutral_button_theme();
                                if (c.value == default_value) {
                                    theme.button = ImVec4(0.30f, 0.30f, 0.32f, 1.0f);
                                    theme.hovered = ImVec4(0.34f, 0.34f, 0.36f, 1.0f);
                                    theme.active = ImVec4(0.24f, 0.24f, 0.26f, 1.0f);
                                }
                                if (core::StyledButton(label.c_str(), ImVec2(core::FillWidth(), 30.0f), theme)) {
                                    submitted = true; result_value = c.value;
                                }
                            }
                            if (kind == ServicesState::ConfigStepKind::SUGGEST) {
                                ImGui::Spacing();
                                ImGui::PushItemWidth(core::AvailableWidth());
                                ImGuiInputTextFlags flags = question_is_password ? ImGuiInputTextFlags_Password : 0;
                                ImGui::InputText("##config_input", state.config_input_buf,
                                                 sizeof(state.config_input_buf), flags);
                                ImGui::PopItemWidth();
                                if (core::StyledButton("Submit custom value", ImVec2(core::FillWidth(), 32.0f), neutral_button_theme())) {
                                    submitted = true;
                                    result_value = state.config_input_buf;
                                }
                            }
                            break;
                        }
                        case ServicesState::ConfigStepKind::INPUT: {
                            ImGui::PushItemWidth(core::AvailableWidth());
                            ImGuiInputTextFlags flags = question_is_password ? ImGuiInputTextFlags_Password : 0;
                            ImGui::InputText("##config_input", state.config_input_buf,
                                             sizeof(state.config_input_buf), flags);
                            ImGui::PopItemWidth();
                            ImGui::Spacing();
                            if (core::StyledButton("Continue", ImVec2(core::FillWidth(), 32.0f), neutral_button_theme())) {
                                submitted = true;
                                result_value = state.config_input_buf;
                            }
                            break;
                        }
                        default:
                            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
                            ImGui::Text("Waiting for next step...");
                            ImGui::PopStyleColor();
                            break;
                    }

                    if (!warning_msg.empty()) {
                        ImGui::Spacing();
                        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.84f, 1.0f));
                        ImGui::TextWrapped("%s", warning_msg.c_str());
                        ImGui::PopStyleColor();
                    }
                    if (!error_msg.empty()) {
                        ImGui::Spacing();
                        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.84f, 1.0f));
                        ImGui::TextWrapped("%s", error_msg.c_str());
                        ImGui::PopStyleColor();
                    }
                }
            }
            ImGui::EndChild();

            if (submitted) {
                state.continue_remote_config(result_value);
            }

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            if (core::StyledButton("Cancel", ImVec2(w, 32.0f), neutral_button_theme())) {
                state.cancel_remote_config();
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
    }

    void ServicesPanel::show_disconnect_confirm_modal(ServicesState& state) {
        if (pending_disconnect_remote_.empty()) return;
        std::string disconnect_label = pending_disconnect_remote_;
        if (const std::string alias = state.get_remote_alias(pending_disconnect_remote_); !alias.empty()) {
            disconnect_label = alias;
        }

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
                disconnect_label.c_str());
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

    void ServicesPanel::show_rename_remote_modal(ServicesState& state) {
        if (pending_rename_remote_.empty()) return;

        if (!ImGui::IsPopupOpen("##rename_remote")) {
            ImGui::OpenPopup("##rename_remote");
        }

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(360.0f, 0.0f), ImGuiCond_Always);

        ImGui::PushStyleColor(ImGuiCol_PopupBg,  ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border,   ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,  ImVec2(24.0f, 24.0f));

        if (ImGui::BeginPopupModal("##rename_remote", nullptr,
                ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {
            const float w = ImGui::GetContentRegionAvail().x;

            core::WithFontScale(1.2f, [&]() {
                const std::string title = "Name Service";
                const float title_w = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - title_w) * 0.5f);
                core::ColoredText(ImVec4(0.92f, 0.92f, 0.93f, 1.0f), "%s", title.c_str());
            });

            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.62f, 0.62f, 0.66f, 1.0f));
            ImGui::TextWrapped("Pick a name that Misty will use in the Services list, sidebar, and Files path.");
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::PushItemWidth(core::AvailableWidth());
            ImGui::InputTextWithHint("##rename_remote_input", "For example: justnatureusa", rename_remote_buf_,
                                     sizeof(rename_remote_buf_));
            ImGui::PopItemWidth();

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            const float half_w = (w - 8.0f) * 0.5f;
            if (core::StyledButton("Skip", ImVec2(half_w, 34.0f), neutral_button_theme())) {
                pending_rename_remote_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine(0.0f, 8.0f);
            if (core::StyledButton("Save", ImVec2(half_w, 34.0f), core::ButtonTheme::Primary())) {
                state.set_remote_alias(pending_rename_remote_, rename_remote_buf_);
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    state.success_msg = "Saved service name";
                }
                pending_rename_remote_.clear();
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
    }

}
