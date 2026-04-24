#include "panels/settings/settings_panel.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

#include "core/commands/command_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/ui/imgui_utils.h"
#include "imgui.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/profile/profile_state.h"
#include "panels/services/services_state.h"
#include "panels/vault/vault_state.h"
#include "views/app_view.h"

namespace fs = std::filesystem;

namespace {

uint64_t get_directory_size(const std::string& dir_path) {
    uint64_t total = 0;
    std::error_code ec;
    if (!fs::exists(dir_path, ec)) return 0;

    for (const auto& entry : fs::recursive_directory_iterator(
             dir_path, fs::directory_options::skip_permission_denied, ec)) {
        if (entry.is_regular_file(ec)) {
            total += entry.file_size(ec);
        }
    }
    return total;
}

std::string format_bytes(uint64_t bytes) {
    if (bytes < 1024) return std::to_string(bytes) + " B";
    if (bytes < 1024 * 1024) return std::to_string(bytes / 1024) + " KB";
    if (bytes < 1024ULL * 1024 * 1024) {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.1f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
        return buf;
    }

    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.2f GB", static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0));
    return buf;
}

std::string default_string(const std::string& value, const char* fallback) {
    return value.empty() ? std::string(fallback) : value;
}

std::string masked_token_summary(const std::string& token) {
    if (token.empty()) return "Unavailable";
    if (token.size() <= 8) return "Present";
    return token.substr(0, 4) + "..." + token.substr(token.size() - 4);
}

} // namespace

namespace misty::panel {

SettingsPanel::SettingsPanel(core::UIRegistry& registry)
    : registry_(registry) {}

void SettingsPanel::render() {
    auto& state = registry_.get_state<SettingsState>("Settings");
    ensure_connection_config_loaded(state);
    sync_account_buffers(state);

    constexpr float kSidebarPaddingX  = 12.0f;
    constexpr float kSidebarPaddingY  = 24.0f;
    constexpr float kContentPaddingX  = 32.0f;
    constexpr float kScrollPaddingY   = 24.0f;
    constexpr float kColumnGap        = 24.0f;

    constexpr ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse;

    core::WithWindowStyle(ImVec4(0.12f, 0.12f, 0.12f, 1.0f), ImVec2(0.0f, 0.0f), [&]() {
        if (ImGui::Begin("SettingsPanel", nullptr, flags)) {
            const float total_w = ImGui::GetContentRegionAvail().x;
            const float total_h = ImGui::GetContentRegionAvail().y;
            const float sidebar_w = 228.0f;
            const float content_w = std::max(0.0f, total_w - sidebar_w - kColumnGap);

            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(kSidebarPaddingX, kSidebarPaddingY));
            ImGui::BeginChild("##settings_sidebar", ImVec2(sidebar_w, 0.0f), false);
            render_sidebar(state, sidebar_w);
            ImGui::EndChild();
            ImGui::PopStyleVar();

            // Vertical divider
            ImGui::SameLine(0.0f, 0.0f);
            ImDrawList* dl = ImGui::GetWindowDrawList();
            ImVec2 p = ImGui::GetCursorScreenPos();
            dl->AddLine(ImVec2(p.x, p.y),
                        ImVec2(p.x, p.y + total_h),
                        IM_COL32(60, 60, 60, 255), 1.0f);

            ImGui::SameLine(0.0f, kColumnGap);

            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(kContentPaddingX, 0.0f));
            ImGui::BeginChild("##settings_content_outer", ImVec2(content_w, 0.0f), false);

            const float status_h = state.status_timer > 0.0f ? 42.0f : 0.0f;
            const float scroll_h = std::max(0.0f, ImGui::GetContentRegionAvail().y - status_h);

            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, kScrollPaddingY));
            ImGui::BeginChild("##settings_content_scroll", ImVec2(0.0f, scroll_h), false,
                              ImGuiWindowFlags_AlwaysVerticalScrollbar);
            if (state.active_section != state.prev_section) {
                ImGui::SetScrollY(0.0f);
                state.prev_section = state.active_section;
            }
            render_content(state);
            ImGui::EndChild();
            ImGui::PopStyleVar(); // scroll child padding

            if (state.status_timer > 0.0f) {
                render_status_bar(state);
            }

            ImGui::EndChild();
            ImGui::PopStyleVar(); // content outer padding
        }
        ImGui::End();
    });
}

void SettingsPanel::render_sidebar(SettingsState& state, float width) {
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.56f, 0.56f, 0.56f, 1.0f));
    ImGui::TextUnformatted("SETTINGS");
    ImGui::PopStyleColor();

    ImGui::Spacing();
    ImGui::Spacing();

    const float btn_w = width;
    render_section_button("Account", SettingsSection::Account, state, btn_w);
    render_section_button("General", SettingsSection::General, state, btn_w);
    render_section_button("Sync", SettingsSection::Sync, state, btn_w);
    render_section_button("Vault", SettingsSection::Vault, state, btn_w);
    render_section_button("Storage", SettingsSection::Storage, state, btn_w);
    render_section_button("Connection", SettingsSection::Connection, state, btn_w);
    render_section_button("AI", SettingsSection::AI, state, btn_w);
    render_section_button("Shortcuts", SettingsSection::Shortcuts, state, btn_w);
    render_section_button("About", SettingsSection::About, state, btn_w);
}

void SettingsPanel::render_section_button(const char* label, SettingsSection section,
                                          SettingsState& state, float width) {
    (void) width;
    const bool selected = state.active_section == section;

    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 9.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ButtonTextAlign, ImVec2(0.0f, 0.5f));

    if (selected) {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.22f, 0.22f, 0.24f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
    } else {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.68f, 0.68f, 0.68f, 1.0f));
    }
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.20f, 1.0f));

    if (ImGui::Button(label, ImVec2(core::FillWidth(), 0.0f))) {
        state.active_section = section;
    }

    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(3);
}

void SettingsPanel::render_content(SettingsState& state) {
    switch (state.active_section) {
        case SettingsSection::Account:    render_account(state); break;
        case SettingsSection::General:    render_general(state); break;
        case SettingsSection::Sync:       render_sync(state); break;
        case SettingsSection::Vault:      render_vault(state); break;
        case SettingsSection::Storage:    render_storage(state); break;
        case SettingsSection::Connection: render_connection(state); break;
        case SettingsSection::AI:         render_ai(state); break;
        case SettingsSection::Shortcuts:  render_shortcuts(state); break;
        case SettingsSection::About:      render_about(state); break;
    }
}

void SettingsPanel::render_section_header(const char* title) {
    core::CustomFont font(core::AssetManager::get().get_font(core::FontID::ROBOTO_BOLD_LARGE));
    core::ColoredText(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", title);
}

void SettingsPanel::render_section_subtitle(const char* subtitle) {
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.62f, 0.62f, 0.62f, 1.0f));
    ImGui::TextWrapped("%s", subtitle);
    ImGui::PopStyleColor();
}

void SettingsPanel::render_section_intro(const char* title, const char* subtitle) {
    render_section_header(title);
    ImGui::Spacing();
    render_section_subtitle(subtitle);
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();
}

void SettingsPanel::render_subsection_header(const char* title) {
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.88f, 0.88f, 0.88f, 1.0f));
    ImGui::TextUnformatted(title);
    ImGui::PopStyleColor();
}

void SettingsPanel::render_value_row(const char* label, const std::string& value) {
    ImGui::PushID(label);

    if (ImGui::BeginTable("##value_row", 2, ImGuiTableFlags_SizingFixedFit | ImGuiTableFlags_NoSavedSettings)) {
        ImGui::TableSetupColumn("##label", ImGuiTableColumnFlags_WidthFixed, 180.0f);
        ImGui::TableSetupColumn("##value", ImGuiTableColumnFlags_WidthStretch);

        ImGui::TableNextRow();
        ImGui::TableNextColumn();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.56f, 0.56f, 0.56f, 1.0f));
        ImGui::TextUnformatted(label);
        ImGui::PopStyleColor();

        ImGui::TableNextColumn();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.92f, 0.92f, 0.92f, 1.0f));
        ImGui::TextWrapped("%s", value.c_str());
        ImGui::PopStyleColor();

        ImGui::EndTable();
    }

    ImGui::PopID();
    ImGui::Spacing();
}

void SettingsPanel::render_toggle_row(const char* label, const char* subtitle, bool& value) {
    ImGui::PushID(label);

    if (ImGui::BeginTable("##toggle_row", 2, ImGuiTableFlags_SizingFixedFit | ImGuiTableFlags_NoSavedSettings)) {
        ImGui::TableSetupColumn("##left", ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("##right", ImGuiTableColumnFlags_WidthFixed, 84.0f);

        ImGui::TableNextRow();
        ImGui::TableNextColumn();
        render_subsection_header(label);
        render_section_subtitle(subtitle);

        ImGui::TableNextColumn();
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 8.0f);
        ImGui::Checkbox("##toggle", &value);

        ImGui::EndTable();
    }

    ImGui::PopID();
    ImGui::Spacing();
}

bool SettingsPanel::render_action_row(const char* label, const char* subtitle, const char* action_label,
                                      float action_width, bool primary, bool danger) {
    bool pressed = false;
    ImGui::PushID(label);

    if (ImGui::BeginTable("##action_row", 2, ImGuiTableFlags_SizingFixedFit | ImGuiTableFlags_NoSavedSettings)) {
        ImGui::TableSetupColumn("##left", ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("##right", ImGuiTableColumnFlags_WidthFixed, action_width + 12.0f);

        ImGui::TableNextRow();
        ImGui::TableNextColumn();
        render_subsection_header(label);
        render_section_subtitle(subtitle);

        ImGui::TableNextColumn();
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 4.0f);

        const core::ButtonColors colors = danger
            ? core::ButtonTheme::Danger()
            : (primary ? core::ButtonTheme::Primary() : core::ButtonColors{});

        if (!danger && !primary) {
            core::ButtonColors muted;
            muted.button = ImVec4(0.22f, 0.22f, 0.24f, 1.0f);
            muted.hovered = ImVec4(0.30f, 0.30f, 0.33f, 1.0f);
            muted.active = ImVec4(0.18f, 0.18f, 0.20f, 1.0f);
            muted.text = ImVec4(0.94f, 0.94f, 0.94f, 1.0f);
            pressed = core::StyledButton(action_label, ImVec2(action_width, 30.0f), muted);
        } else {
            pressed = core::StyledButton(action_label, ImVec2(action_width, 30.0f), colors);
        }

        ImGui::EndTable();
    }

    ImGui::PopID();
    ImGui::Spacing();
    return pressed;
}

void SettingsPanel::sync_account_buffers(SettingsState& state) {
    if (state.account_buffers_initialized) return;

    auto& profile = registry_.get_state<ProfileState>("Profile");
    const auto session_email = core::SessionManager::get().get_email();

    const std::string display_name = profile.display_name.empty() ? "User" : profile.display_name;
    const std::string email = !profile.email.empty() ? profile.email : session_email;

    std::strncpy(state.account_display_name, display_name.c_str(), sizeof(state.account_display_name) - 1);
    std::strncpy(state.account_email, email.c_str(), sizeof(state.account_email) - 1);
    state.account_buffers_initialized = true;
}

void SettingsPanel::ensure_connection_config_loaded(SettingsState& state) {
    if (state.connection_config_loaded) return;

    const std::string mount_path = core::EnvManager::get().get("MISTY_MOUNT_PATH", "");
    const std::string server_address = core::EnvManager::get().get("MISTY_GRPC_ADDRESS", "");
    if (!mount_path.empty()) {
        std::strncpy(state.mount_path, mount_path.c_str(), sizeof(state.mount_path) - 1);
    }
    if (!server_address.empty()) {
        std::strncpy(state.server_address, server_address.c_str(), sizeof(state.server_address) - 1);
    }

    state.connection_config_loaded = true;
}

void SettingsPanel::set_status(SettingsState& state, std::string message, float seconds, bool is_error) {
    state.status_message = std::move(message);
    state.status_timer = seconds;
    state.status_is_error = is_error;
}

void SettingsPanel::render_account(SettingsState& state) {
    auto& profile = registry_.get_state<ProfileState>("Profile");
    auto& session = core::SessionManager::get();

    render_section_intro("Account", "Manage your signed-in identity and the current session.");

    render_subsection_header("Profile");
    render_section_subtitle("These fields are local UI profile details used across the desktop app.");
    ImGui::Spacing();

    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 8.0f));
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.82f, 1.0f));
    ImGui::TextUnformatted("Display Name");
    ImGui::PopStyleColor();
    ImGui::SetNextItemWidth(320.0f);
    ImGui::InputText("##account_display_name", state.account_display_name, IM_ARRAYSIZE(state.account_display_name));

    ImGui::Spacing();

    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.82f, 1.0f));
    ImGui::TextUnformatted("Email");
    ImGui::PopStyleColor();
    ImGui::SetNextItemWidth(320.0f);
    ImGui::InputText("##account_email", state.account_email, IM_ARRAYSIZE(state.account_email));

    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);

    ImGui::Spacing();

    if (render_action_row("Save Profile", "Persist these profile details for this desktop session.", "Save", 116.0f, true)) {
        profile.display_name = state.account_display_name;
        profile.email = state.account_email;
        session.set_email(state.account_email);
        set_status(state, "Profile details updated.");
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    render_subsection_header("Session");
    render_section_subtitle("Live identity information comes from the current authenticated session.");
    ImGui::Spacing();

    render_value_row("Signed in as", default_string(session.get_email(), "Unavailable"));
    render_value_row("User ID", default_string(session.get_user_id(), "Unavailable"));
    render_value_row("Session State", session.is_session_expired()
        ? "Expired"
        : (session.is_authenticated() ? "Connected" : "Signed out"));
    render_value_row("License Token", masked_token_summary(session.get_license_token()));

    const bool session_expired = session.is_session_expired();
    const bool authenticated = session.is_authenticated();

    if (render_action_row("Profile Editor",
                          "Open the dedicated profile editor view for the existing workflow.",
                          "Open", 116.0f)) {
        view::switch_view(view::ViewID::EditProfile);
    }

    if (session_expired) {
        if (render_action_row("Reconnect",
                              "The saved session expired. Clear it and return to login.",
                              "Reconnect", 128.0f, true)) {
            session.clear_token();
            session.clear_session_expired();
            view::switch_view(view::ViewID::Login);
        }
    } else if (authenticated) {
        if (render_action_row("Sign Out",
                              "Clear local authentication state and return to login.",
                              "Sign Out", 128.0f, false, true)) {
            session.clear_token();
            view::switch_view(view::ViewID::Login);
        }
    }
}

void SettingsPanel::render_general(SettingsState& state) {
    render_section_intro("General", "Choose how Misty boots and where you want to land first.");

    render_subsection_header("Startup");
    render_section_subtitle("Pick the default view shown after launch.");
    ImGui::Spacing();

    const char* view_items[] = {"File Explorer", "Services", "Activity"};

    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 8.0f));
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));
    ImGui::SetNextItemWidth(260.0f);
    ImGui::Combo("##startup_view", &state.startup_view_index, view_items, IM_ARRAYSIZE(view_items));
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    render_value_row("Theme", "Dark (the only available theme right now)");
    render_value_row("Open Settings Shortcut", core::CommandManager::get().label("app.open_settings"));

    if (render_action_row("Keyboard Shortcuts",
                          "Review the current bindings or jump directly to the shortcuts section.",
                          "Open", 116.0f)) {
        state.active_section = SettingsSection::Shortcuts;
    }
}

void SettingsPanel::render_sync(SettingsState& state) {
    auto& services = registry_.get_state<ServicesState>("Services");
    auto& session = core::SessionManager::get();

    size_t connection_count = 0;
    {
        std::lock_guard<std::mutex> lock(services.mu);
        connection_count = services.connections.size();
    }

    render_section_intro("Sync", "Control background synchronization and see cloud account status at a glance.");

    render_toggle_row("Background Sync",
                      "Keep remote file status and metadata refreshed while you work.",
                      state.auto_sync_enabled);

    render_value_row("Connected Services", std::to_string(connection_count));
    render_value_row("Proxy Status", session.is_proxy_available() ? "Online" : "Offline");
    render_value_row("Sync State", state.auto_sync_enabled ? "Active" : "Paused");

    if (!session.is_proxy_available()) {
        render_section_subtitle(session.get_proxy_status_message().c_str());
        ImGui::Spacing();
    }

    if (render_action_row("Cloud Services",
                          "Manage connected storage providers in the dedicated services workspace.",
                          "Open", 116.0f)) {
        view::switch_view(view::ViewID::Services);
    }
}

void SettingsPanel::render_vault(SettingsState& state) {
    auto& vault = registry_.get_state<VaultState>("Vault");

    const auto repos = vault.repos_snapshot();
    VaultJobProgress latest_job;
    const bool has_job = vault.latest_job(latest_job);

    render_section_intro("Vault", "See backup status and jump into the dedicated encrypted backup workflow.");

    render_value_row("Repositories", std::to_string(repos.size()));

    {
        std::lock_guard<std::mutex> lock(vault.mu);
        render_value_row("Selected Repository", default_string(vault.selected_repo, "None selected"));
    }

    if (has_job) {
        std::string job_summary = latest_job.job_type + " - " + latest_job.state;
        if (latest_job.state == "running") {
            char percent_buf[32];
            std::snprintf(percent_buf, sizeof(percent_buf), "%.0f%%", latest_job.percent_done * 100.0);
            job_summary += " (" + std::string(percent_buf) + ")";
        }
        render_value_row("Latest Job", job_summary);
    } else {
        render_value_row("Latest Job", "No backup or restore jobs started this session");
    }

    if (repos.empty()) {
        render_section_subtitle("Open the Vault workspace to initialize repositories and run backup jobs.");
        ImGui::Spacing();
    }

    if (render_action_row("Vault Workspace",
                          "Open the full vault screen to manage repositories, snapshots, backups, and restores.",
                          "Open", 116.0f)) {
        view::switch_view(view::ViewID::Vault);
    }
}

void SettingsPanel::render_storage(SettingsState& state) {
    auto& explorer = registry_.get_state<FileExplorerState>("Files");

    const char* home = std::getenv("HOME");
    const std::string cache_dir = home ? std::string(home) + "/misty/.cache" : "";
    const std::string trash_dir = cache_dir + "/trash";
    const std::string state_file = cache_dir + "/explorer_state.json";

    const uint64_t cache_size = get_directory_size(cache_dir);
    const uint64_t trash_size = get_directory_size(trash_dir);

    render_section_intro("Storage", "Manage local cache data, quick-access metadata, and trash.");

    render_value_row("Cache Directory", cache_dir.empty() ? "Unavailable" : cache_dir);
    render_value_row("Cache Size", format_bytes(cache_size));
    render_value_row("Explorer State File", state_file);

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    if (render_action_row("Recent Files",
                          ("Clear the recent files list (" + std::to_string(explorer.recent_files.size()) + " items).").c_str(),
                          state.confirm_clear_recent ? "Confirm" : "Clear",
                          116.0f, false, state.confirm_clear_recent)) {
        if (state.confirm_clear_recent) {
            explorer.recent_files.clear();
            explorer.dirty_ = true;
            state.confirm_clear_recent = false;
            set_status(state, "Recent files cleared.");
        } else {
            state.confirm_clear_recent = true;
        }
    }
    if (state.confirm_clear_recent && render_action_row("Recent Files Cancel",
                                                        "Cancel clearing the recent files list.",
                                                        "Cancel", 116.0f)) {
        state.confirm_clear_recent = false;
    }

    if (render_action_row("Starred Files",
                          ("Clear the starred files list (" + std::to_string(explorer.starred_files.size()) + " items).").c_str(),
                          state.confirm_clear_starred ? "Confirm" : "Clear",
                          116.0f, false, state.confirm_clear_starred)) {
        if (state.confirm_clear_starred) {
            explorer.starred_files.clear();
            explorer.dirty_ = true;
            state.confirm_clear_starred = false;
            set_status(state, "Starred files cleared.");
        } else {
            state.confirm_clear_starred = true;
        }
    }
    if (state.confirm_clear_starred && render_action_row("Starred Files Cancel",
                                                         "Cancel clearing the starred files list.",
                                                         "Cancel", 116.0f)) {
        state.confirm_clear_starred = false;
    }

    if (render_action_row("Trash",
                          ("Permanently delete all trashed files (" +
                           std::to_string(explorer.trash_files.size()) + " items, " +
                           format_bytes(trash_size) + ").").c_str(),
                          state.confirm_empty_trash ? "Delete" : "Empty",
                          116.0f, false, true)) {
        if (state.confirm_empty_trash) {
            std::error_code ec;
            if (fs::exists(trash_dir, ec)) {
                fs::remove_all(trash_dir, ec);
                fs::create_directories(trash_dir, ec);
            }
            explorer.trash_files.clear();
            state.confirm_empty_trash = false;
            set_status(state, "Trash emptied.");
        } else {
            state.confirm_empty_trash = true;
        }
    }
    if (state.confirm_empty_trash && render_action_row("Trash Cancel",
                                                       "Cancel permanently deleting the trash contents.",
                                                       "Cancel", 116.0f)) {
        state.confirm_empty_trash = false;
    }
}

void SettingsPanel::render_connection(SettingsState& state) {
    auto& session = core::SessionManager::get();

    render_section_intro("Connection", "Inspect live connectivity for the background service, authentication, and local client config.");

    render_value_row("Background Service", session.is_proxy_available() ? "Online" : "Offline");
    render_value_row("Proxy Message", default_string(session.get_proxy_status_message(), "No current proxy warning"));
    render_value_row("Authentication", session.is_session_expired()
        ? "Expired"
        : (session.is_authenticated() ? "Authenticated" : "Signed out"));
    render_value_row("License Token", session.get_license_token().empty() ? "Missing" : "Present");
    render_value_row("Configured Mount Path", state.mount_path);
    render_value_row("Configured Address", state.server_address);

    if (session.is_session_expired()) {
        if (render_action_row("Reconnect Session",
                              "Clear the expired session and return to the login view.",
                              "Reconnect", 128.0f, true)) {
            session.clear_token();
            session.clear_session_expired();
            view::switch_view(view::ViewID::Login);
        }
    }
}

void SettingsPanel::render_shortcuts(SettingsState& state) {
    (void)state;

    auto& commands = core::CommandManager::get();

    render_section_intro("Shortcuts", "Review the current keyboard bindings loaded by the desktop client.");

    render_subsection_header("Global");
    ImGui::Spacing();
    render_value_row("Open Settings", commands.label("app.open_settings"));
    render_value_row("Toggle Search", commands.label("search.toggle"));
    render_value_row("Confirm Modal", commands.label("modal.confirm"));
    render_value_row("Cancel Modal", commands.label("modal.cancel"));

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    render_subsection_header("Explorer");
    ImGui::Spacing();
    render_value_row("Refresh", commands.label("explorer.refresh"));
    render_value_row("Rename", commands.label("explorer.rename"));
    render_value_row("Delete", commands.label("explorer.delete"));
    render_value_row("Copy", commands.label("explorer.copy"));
    render_value_row("Cut", commands.label("explorer.cut"));
    render_value_row("Paste", commands.label("explorer.paste"));
    render_value_row("Toggle Chat", commands.label("explorer.toggle_chat"));
    render_value_row("New Tab", commands.label("explorer.new_tab"));
    render_value_row("Reopen Closed", commands.label("explorer.restore_tab"));
    render_value_row("Close Current", commands.label("explorer.close_pane"));
    render_value_row("Restore Pane", commands.label("explorer.restore_pane"));
    render_value_row("Split Vertical", commands.label("explorer.split_vertical"));
    render_value_row("Split Horizontal", commands.label("explorer.split_horizontal"));
    render_value_row("Tab 1", commands.label("explorer.tab_1"));
    render_value_row("Tab 2", commands.label("explorer.tab_2"));
    render_value_row("Tab 3", commands.label("explorer.tab_3"));
    render_value_row("Tab 4", commands.label("explorer.tab_4"));
    render_value_row("Tab 5", commands.label("explorer.tab_5"));
    render_value_row("Tab 6", commands.label("explorer.tab_6"));
    render_value_row("Tab 7", commands.label("explorer.tab_7"));
    render_value_row("Tab 8", commands.label("explorer.tab_8"));
    render_value_row("Tab 9", commands.label("explorer.tab_9"));

    ImGui::Spacing();
    render_section_subtitle("Bindings are loaded only from ~/misty/config/commands.msy. Misty creates that file automatically if it does not exist.");
}

void SettingsPanel::render_ai(SettingsState& state) {
    (void)state;

    render_section_intro("AI", "Misty AI is managed by the proxy and uses a built-in Gemini endpoint for lightweight file-context questions.");

    render_subsection_header("Behavior");
    render_section_subtitle("The Files chat overlay works without per-user API setup. Misty sends the current path, visible entries, and selected text-file excerpts to the proxy when you ask a question.");
    ImGui::Spacing();

    render_value_row("Provider", "Google Gemini via Misty proxy");
    render_value_row("Model", "gemini-2.5-flash");
    render_value_row("Chat Toggle", core::CommandManager::get().label("explorer.toggle_chat"));
    render_value_row("Setup", "No desktop API key required");

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    render_subsection_header("Privacy");
    render_section_subtitle("Only the prompt and the local file context attached to that prompt are sent. Chat history is kept in memory only for the current tab and is not saved to disk.");
}

void SettingsPanel::render_about(SettingsState& state) {
    (void)state;

    render_section_intro("About", "Misty is the desktop client for local files, cloud remotes, and vault backups.");

    render_value_row("Application", "Misty");
    render_value_row("Version", "1.0.0");
    render_value_row("Build", std::string(__DATE__) + " " + std::string(__TIME__));
    render_value_row("Platform",
#if defined(__APPLE__)
        "macOS"
#elif defined(_WIN32)
        "Windows"
#elif defined(__linux__)
        "Linux"
#else
        "Unknown"
#endif
    );
    render_value_row("C++ Standard", "C++20");
    render_value_row("Session Directory", "~/.misty");

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    render_subsection_header("Libraries");
    ImGui::Spacing();
    render_value_row("UI", "Dear ImGui");
    render_value_row("Rendering", "GLFW + OpenGL");
    render_value_row("Cloud / RPC", "gRPC + Protobuf + libcurl");
    render_value_row("Data / SVG", "nlohmann/json + LunaSVG");
}

void SettingsPanel::render_status_bar(SettingsState& state) {
    if (state.status_timer <= 0.0f) return;

    state.status_timer -= ImGui::GetIO().DeltaTime;

    const float alpha = std::clamp(state.status_timer, 0.0f, 1.0f);
    const ImVec4 color = state.status_is_error
        ? ImVec4(0.92f, 0.42f, 0.42f, alpha)
        : ImVec4(0.32f, 0.86f, 0.54f, alpha);

    ImGui::PushStyleColor(ImGuiCol_Text, color);
    ImGui::TextWrapped("%s", state.status_message.c_str());
    ImGui::PopStyleColor();
}

} // namespace misty::panel
