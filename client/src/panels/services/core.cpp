#include "services_panel.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/manager/font_manager.h"
#include "core/ui/ui_animate.h"
#include "core/ui/ui_style.h"

#include <algorithm>
#include <cctype>
#include <cstdarg>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace misty::panel {

    namespace {
        constexpr float kRemoteCardHeight = 124.0f;
        struct ButtonStyle {
            ImVec4 button;
            ImVec4 hovered;
            ImVec4 active;
            ImVec4 text;
            float rounding;
        };

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

        std::vector<ServicesPanel::ProviderInfo> provider_snapshot(ServicesState& state) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.provider_types.empty()) {
                return ServicesPanel::supported_providers();
            }

            std::vector<ServicesPanel::ProviderInfo> providers;
            providers.reserve(state.provider_types.size());
            for (const auto& provider : state.provider_types) {
                if (provider.type.empty()) continue;
                providers.push_back({
                    provider.type,
                    provider.display_name.empty() ? provider.type : provider.display_name,
                });
            }
            return providers;
        }

        ButtonStyle primary_button_style() {
            return {
                ImVec4(0.957f, 0.957f, 0.961f, 1.0f),
                ImVec4(0.898f, 0.906f, 0.922f, 1.0f),
                ImVec4(0.820f, 0.835f, 0.859f, 1.0f),
                ImVec4(0.07f, 0.07f, 0.07f, 1.0f),
                8.0f,
            };
        }

        ButtonStyle neutral_button_style() {
            return {
                ImVec4(0.23f, 0.23f, 0.24f, 1.0f),
                ImVec4(0.29f, 0.29f, 0.31f, 1.0f),
                ImVec4(0.19f, 0.19f, 0.20f, 1.0f),
                ImVec4(0.94f, 0.94f, 0.95f, 1.0f),
                8.0f,
            };
        }

        std::string ellipsize_path_text(const std::string& text, float max_width) {
            if (text.empty() || ImGui::CalcTextSize(text.c_str()).x <= max_width) return text;
            static constexpr const char* kEllipsis = "...";
            const std::size_t keep = std::min<std::size_t>(text.size(), 28);
            std::string compact = kEllipsis + text.substr(text.size() - keep);
            if (ImGui::CalcTextSize(compact.c_str()).x <= max_width) return compact;
            return ellipsize_text(text, max_width);
        }

        float available_width(float reserve = 0.0f) {
            const float width = ImGui::GetContentRegionAvail().x - reserve;
            return width > 1.0f ? width : 1.0f;
        }

        float fill_width() {
            return -FLT_MIN;
        }

        bool styled_button(const char* label, const ImVec2& size, const ButtonStyle& style) {
            bool pressed = false;
            misty::UI::WithStyle([&](misty::UI::StyleScope& scoped) {
                scoped.var(ImGuiStyleVar_FrameRounding, style.rounding);
                scoped.color(ImGuiCol_Button, style.button);
                scoped.color(ImGuiCol_ButtonHovered, style.hovered);
                scoped.color(ImGuiCol_ButtonActive, style.active);
                scoped.color(ImGuiCol_Text, style.text);
                pressed = ImGui::Button(label, size);
            });
            return pressed;
        }

        void text_colored(const ImVec4& color, const char* fmt, ...) {
            char buffer[1024];
            va_list args;
            va_start(args, fmt);
            std::vsnprintf(buffer, sizeof(buffer), fmt, args);
            va_end(args);

            misty::UI::WithTextColor(color, [&]() {
                ImGui::TextUnformatted(buffer);
            });
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

        misty::UI::WithWindowStyle({
            .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
            .padding = ImVec2(32.0f, 24.0f),
        }, [&]() {
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
                text_colored(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%s", error_msg.c_str());
            }

            if (!success_msg.empty()) {
                ImGui::Spacing();
                text_colored(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%s", success_msg.c_str());
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
        misty::UI::WithFontScale(1.8f, []() {
            text_colored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Services");
        });
        text_colored(ImVec4(0.70f, 0.70f, 0.70f, 1.0f),
                          "Search your connected remotes and add new services from a single chooser.");
        ImGui::Spacing();
        text_colored(ImVec4(0.82f, 0.82f, 0.84f, 1.0f), "%zu connected", connection_count);
        ImGui::SameLine(0.0f, 18.0f);
        text_colored(ImVec4(0.58f, 0.58f, 0.62f, 1.0f), "%zu providers", provider_snapshot(state).size());
        ImGui::SameLine(0.0f, 18.0f);
        text_colored(ImVec4(0.66f, 0.66f, 0.69f, 1.0f),
                          "%s", is_refreshing ? "Refreshing remotes" : "Ready");
        ImGui::EndGroup();

        ImGui::SameLine();
        const float refresh_width = 112.0f;
        ImGui::Dummy(ImVec2(std::max(0.0f, ImGui::GetContentRegionAvail().x - refresh_width), 0.0f));
        ImGui::SameLine();
        if (is_refreshing) ImGui::BeginDisabled();
        if (styled_button("Refresh", ImVec2(refresh_width, 30.0f), primary_button_style())) {
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

        misty::UI::WithFontScale(1.2f, []() {
            text_colored(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "Connected Services");
        });
        text_colored(ImVec4(0.56f, 0.56f, 0.60f, 1.0f),
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
                misty::UI::WithFontScale(1.1f, []() {
                    text_colored(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "No services connected yet");
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
                text_colored(ImVec4(0.96f, 0.96f, 0.97f, 1.0f), "No matching services");
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
                text_colored(ImVec4(0.72f, 0.72f, 0.75f, 1.0f), "%s", provider_name.c_str());
                ImGui::TableNextColumn();
                text_colored(status_color, "%s", status_label.c_str());
                ImGui::EndTable();
            }

            misty::UI::WithFontScale(1.12f, [&]() {
                text_colored(ImVec4(0.97f, 0.97f, 0.98f, 1.0f), "%s",
                                  ellipsize_text(account_name, std::max(40.0f, card_width - 32.0f)).c_str());
            });
            ImGui::Spacing();
            text_colored(ImVec4(0.60f, 0.60f, 0.64f, 1.0f), "Available in Files and Vault");
            ImGui::Spacing();

            if (ImGui::BeginTable("##service_card_actions", 2,
                                  ImGuiTableFlags_SizingStretchSame | ImGuiTableFlags_NoSavedSettings)) {
                ImGui::TableSetupColumn("rename", ImGuiTableColumnFlags_WidthFixed, 96.0f);
                ImGui::TableSetupColumn("disconnect", ImGuiTableColumnFlags_WidthFixed, 104.0f);
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                if (styled_button("Rename", ImVec2(96.0f, 26.0f), neutral_button_style())) {
                    pending_rename_remote_ = conn.name;
                    std::memset(rename_remote_buf_, 0, sizeof(rename_remote_buf_));
                    if (!conn.alias.empty() && conn.alias.size() < sizeof(rename_remote_buf_)) {
                        std::memcpy(rename_remote_buf_, conn.alias.c_str(), conn.alias.size() + 1);
                    }
                }
                ImGui::TableNextColumn();
                if (styled_button("Disconnect", ImVec2(104.0f, 26.0f), neutral_button_style())) {
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
        RcloneHealth rclone_health;
        bool proxy_restart_in_flight = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            rclone_health = state.rclone_health;
            proxy_restart_in_flight = state.proxy_restart_in_flight;
        }

        if (!rclone_health.loaded) {
            state.refresh_rclone_health();
        }

        const ImVec4 panel_bg = rclone_health.ready
            ? ImVec4(0.15f, 0.18f, 0.15f, 1.0f)
            : ImVec4(0.18f, 0.14f, 0.14f, 1.0f);
        const ImVec4 heading_color = rclone_health.ready
            ? ImVec4(0.90f, 0.95f, 0.90f, 1.0f)
            : ImVec4(0.96f, 0.90f, 0.90f, 1.0f);
        const ImVec4 detail_color = rclone_health.ready
            ? ImVec4(0.68f, 0.76f, 0.68f, 1.0f)
            : ImVec4(0.82f, 0.72f, 0.72f, 1.0f);

        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, panel_bg);
        if (ImGui::BeginChild("##rclone_health", ImVec2(0.0f, 92.0f), true,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
            const char* status_title = rclone_health.loading
                ? "Checking rclone"
                : (rclone_health.ready ? "rclone ready" : "rclone required");
            text_colored(heading_color, "%s", status_title);
            ImGui::Spacing();

            if (rclone_health.loading) {
                text_colored(detail_color, "Waiting for proxy health status...");
            } else if (rclone_health.ready) {
                const std::string version = rclone_health.rclone_version.empty()
                    ? "External rclone detected."
                    : "Version " + rclone_health.rclone_version;
                text_colored(detail_color, "%s", version.c_str());
                if (!rclone_health.rclone_path.empty()) {
                    text_colored(detail_color, "%s",
                                      ellipsize_path_text(rclone_health.rclone_path, available_width()).c_str());
                }
                if (rclone_health.link_present && !rclone_health.link_path.empty()) {
                    std::string managed = "Managed link: " + rclone_health.link_path;
                    text_colored(detail_color, "%s",
                                      ellipsize_path_text(managed, available_width()).c_str());
                }
            } else {
                const std::string message = !rclone_health.error.empty()
                    ? rclone_health.error
                    : "Misty could not find an rclone binary.";
                text_colored(detail_color, "%s", message.c_str());
                if (!rclone_health.link_path.empty()) {
                    std::string hint = "Expected link: " + rclone_health.link_path;
                    text_colored(detail_color, "%s",
                                      ellipsize_path_text(hint, available_width()).c_str());
                }
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);

        ImGui::Spacing();
        ImGui::PushItemWidth(available_width());
        ImGui::InputTextWithHint("##services_search", "Search connected services", remote_search_buf_,
                                 sizeof(remote_search_buf_));
        ImGui::PopItemWidth();
        ImGui::Spacing();

        const bool disable_add = !rclone_health.loading && rclone_health.loaded && !rclone_health.ready;
        const float action_width = (available_width() - kCardSpacing) * 0.5f;
        if (disable_add) ImGui::BeginDisabled();
        if (styled_button("Add Service", ImVec2(action_width, 0.0f), primary_button_style())) {
            provider_search_buf_[0] = '\0';
            state.refresh_provider_types();
            state.refresh_rclone_health(true);
            state.show_login_modal = true;
        }
        if (disable_add) ImGui::EndDisabled();
        ImGui::SameLine(0.0f, kCardSpacing);
        if (styled_button("Check", ImVec2(action_width, 0.0f), neutral_button_style())) {
            state.refresh_rclone_health(true);
        }

        ImGui::Spacing();
        if (proxy_restart_in_flight) ImGui::BeginDisabled();
        if (styled_button("Restart Proxy", ImVec2(fill_width(), 0.0f), neutral_button_style())) {
            state.restart_proxy();
        }
        if (proxy_restart_in_flight) ImGui::EndDisabled();
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

            misty::UI::WithFontScale(1.3f, [&]() {
                std::string title = "Add Service";
                float title_w = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - title_w) * 0.5f);
                text_colored(ImVec4(0.9f, 0.9f, 0.9f, 1.0f), "%s", title.c_str());
            });

            ImGui::Spacing();
            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::TextWrapped(
                "Choose a provider to create a new remote. A remote name is generated automatically and the setup flow starts immediately.");
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::PushItemWidth(available_width());
            ImGui::InputTextWithHint("##provider_search", "Search providers", provider_search_buf_,
                                     sizeof(provider_search_buf_));
            ImGui::PopItemWidth();

            size_t visible_count = 0;
            const auto providers = provider_snapshot(state);
            for (const auto& provider : providers) {
                if (!matches_provider_filter(provider.type, provider.display_name, provider_search_buf_)) {
                    continue;
                }

                ++visible_count;
                ImGui::Spacing();
                if (styled_button(provider.display_name.c_str(), ImVec2(fill_width(), 34.0f), neutral_button_style())) {
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
            if (styled_button("Cancel", ImVec2(w, 36.0f), neutral_button_style()) || cancel_shortcut) {
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
        misty::UI::DrawMistyLoadingAnimation(p, ImVec2(p.x + sz.x, p.y + sz.y));
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
            misty::UI::WithFontScale(1.3f, [&]() {
                std::string provider_name = display_name_for_provider(provider_type);
                std::string title = provider_name.empty() ? "Configure Service" : "Configure " + provider_name;
                float tw = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - tw) * 0.5f);
                text_colored(ImVec4(0.9f, 0.9f, 0.9f, 1.0f), "%s", title.c_str());
            });
            ImGui::Spacing();
            if (!remote_name.empty() && remote_name.find('@') != std::string::npos) {
                float subtitle_w = ImGui::CalcTextSize(remote_name.c_str()).x;
                ImGui::SetCursorPosX((w - subtitle_w) * 0.5f);
                text_colored(ImVec4(0.62f, 0.62f, 0.66f, 1.0f), "%s", remote_name.c_str());
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
                        text_colored(ImVec4(0.92f, 0.92f, 0.93f, 1.0f), "%s", question_name.c_str());
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
                            if (styled_button("Yes", ImVec2(half, 32.0f), neutral_button_style())) {
                                submitted = true; result_value = "true";
                            }
                            ImGui::SameLine(0, 8.0f);
                            if (styled_button("No", ImVec2(half, 32.0f), neutral_button_style())) {
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
                                ButtonStyle theme = neutral_button_style();
                                if (c.value == default_value) {
                                    theme.button = ImVec4(0.30f, 0.30f, 0.32f, 1.0f);
                                    theme.hovered = ImVec4(0.34f, 0.34f, 0.36f, 1.0f);
                                    theme.active = ImVec4(0.24f, 0.24f, 0.26f, 1.0f);
                                }
                                if (styled_button(label.c_str(), ImVec2(fill_width(), 30.0f), theme)) {
                                    submitted = true; result_value = c.value;
                                }
                            }
                            if (kind == ServicesState::ConfigStepKind::SUGGEST) {
                                ImGui::Spacing();
                                ImGui::PushItemWidth(available_width());
                                ImGuiInputTextFlags flags = question_is_password ? ImGuiInputTextFlags_Password : 0;
                                ImGui::InputText("##config_input", state.config_input_buf,
                                                 sizeof(state.config_input_buf), flags);
                                ImGui::PopItemWidth();
                                if (styled_button("Submit custom value", ImVec2(fill_width(), 32.0f), neutral_button_style())) {
                                    submitted = true;
                                    result_value = state.config_input_buf;
                                }
                            }
                            break;
                        }
                        case ServicesState::ConfigStepKind::INPUT: {
                            ImGui::PushItemWidth(available_width());
                            ImGuiInputTextFlags flags = question_is_password ? ImGuiInputTextFlags_Password : 0;
                            ImGui::InputText("##config_input", state.config_input_buf,
                                             sizeof(state.config_input_buf), flags);
                            ImGui::PopItemWidth();
                            ImGui::Spacing();
                            if (styled_button("Continue", ImVec2(fill_width(), 32.0f), neutral_button_style())) {
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

            if (styled_button("Cancel", ImVec2(w, 32.0f), neutral_button_style())) {
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

            ImGui::PushFont(core::FontManager::get().get_font(core::FontID::ROBOTO_LARGE));
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

            misty::UI::WithFontScale(1.2f, [&]() {
                const std::string title = "Name Service";
                const float title_w = ImGui::CalcTextSize(title.c_str()).x;
                ImGui::SetCursorPosX((w - title_w) * 0.5f);
                text_colored(ImVec4(0.92f, 0.92f, 0.93f, 1.0f), "%s", title.c_str());
            });

            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.62f, 0.62f, 0.66f, 1.0f));
            ImGui::TextWrapped("Pick a name that Misty will use in the Services list, sidebar, and Files path.");
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::PushItemWidth(available_width());
            ImGui::InputTextWithHint("##rename_remote_input", "For example: justnatureusa", rename_remote_buf_,
                                     sizeof(rename_remote_buf_));
            ImGui::PopItemWidth();

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            const float half_w = (w - 8.0f) * 0.5f;
            if (styled_button("Skip", ImVec2(half_w, 34.0f), neutral_button_style())) {
                pending_rename_remote_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine(0.0f, 8.0f);
            if (styled_button("Save", ImVec2(half_w, 34.0f), primary_button_style())) {
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
