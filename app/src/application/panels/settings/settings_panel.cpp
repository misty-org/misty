#include "panels/settings/settings_panel.h"
#include "panels/settings/settings_state.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/services/services_state.h"
#include "imgui.h"

#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

namespace misty::panel {

    SettingsPanel::SettingsPanel(core::UIRegistry& registry)
        : registry_(registry) {}

    void SettingsPanel::render() {
        auto& state = registry_.get_state<SettingsState>("Settings");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.11f, 0.11f, 0.11f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));

        if (ImGui::Begin("SettingsPanel", nullptr, flags)) {
            float total_w = ImGui::GetWindowWidth();
            float sidebar_w = 200.0f;
            float content_w = total_w - sidebar_w;

            // Left sidebar
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.13f, 0.13f, 0.13f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 20.0f));
            ImGui::BeginChild("##settings_sidebar", ImVec2(sidebar_w, 0), false);
            render_sidebar(state, sidebar_w);
            ImGui::EndChild();
            ImGui::PopStyleVar();
            ImGui::PopStyleColor();

            ImGui::SameLine(0, 0);

            // Right content area
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(32.0f, 24.0f));
            ImGui::BeginChild("##settings_content", ImVec2(content_w, 0), false);
            render_content(state);
            ImGui::EndChild();
            ImGui::PopStyleVar();
        }
        ImGui::End();

        ImGui::PopStyleVar();
        ImGui::PopStyleColor();
    }

    // ---------------------------------------------------------------
    // Sidebar
    // ---------------------------------------------------------------
    void SettingsPanel::render_sidebar(SettingsState& state, float width) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::SetCursorPosX(24.0f);
        ImGui::Text("SETTINGS");
        ImGui::PopStyleColor();
        ImGui::Spacing();
        ImGui::Spacing();

        float btn_w = width - 24.0f;
        render_section_button("General",        SettingsSection::General,  state, btn_w);
        render_section_button("Storage & Cache", SettingsSection::Storage,  state, btn_w);
        render_section_button("Cloud Services", SettingsSection::Services, state, btn_w);
        render_section_button("Server",         SettingsSection::Server,   state, btn_w);
        render_section_button("About",          SettingsSection::About,    state, btn_w);
    }

    void SettingsPanel::render_section_button(const char* label, SettingsSection section,
                                              SettingsState& state, float width) {
        bool selected = (state.active_section == section);
        ImGui::SetCursorPosX(12.0f);

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ButtonTextAlign, ImVec2(0.0f, 0.5f));

        if (selected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.22f, 0.22f, 0.22f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text,   ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        } else {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_Text,   ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        }
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));

        if (ImGui::Button(label, ImVec2(width, 0))) {
            state.active_section = section;
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(3);
    }

    // ---------------------------------------------------------------
    // Content router
    // ---------------------------------------------------------------
    void SettingsPanel::render_content(SettingsState& state) {
        switch (state.active_section) {
            case SettingsSection::General:  render_general(state);  break;
            case SettingsSection::Storage:  render_storage(state);  break;
            case SettingsSection::Services: render_services(state); break;
            case SettingsSection::Server:   render_server(state);   break;
            case SettingsSection::About:    render_about(state);    break;
        }

        // Status bar at bottom
        render_status_bar(state);
    }

    // ---------------------------------------------------------------
    // General
    // ---------------------------------------------------------------
    void SettingsPanel::render_general(SettingsState& state) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::Text("General");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::TextWrapped("Configure general application preferences.");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        // Startup View
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Startup View");
        ImGui::PopStyleColor();

        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::TextWrapped("Choose which view to show when the app starts.");
        ImGui::PopStyleColor();

        ImGui::Spacing();

        const char* view_items[] = { "File Explorer", "Services", "Activity" };
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 8.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));
        ImGui::SetNextItemWidth(240.0f);
        ImGui::Combo("##startup_view", &state.startup_view_index, view_items, IM_ARRAYSIZE(view_items));
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        // Theme
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Theme");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::TextWrapped("Theme support is coming soon. Currently using dark mode.");
        ImGui::PopStyleColor();
    }

    // ---------------------------------------------------------------
    // Storage & Cache
    // ---------------------------------------------------------------
    static uint64_t get_directory_size(const std::string& dir_path) {
        uint64_t total = 0;
        std::error_code ec;
        if (!fs::exists(dir_path, ec)) return 0;
        for (const auto& entry : fs::recursive_directory_iterator(dir_path, fs::directory_options::skip_permission_denied, ec)) {
            if (entry.is_regular_file(ec)) {
                total += entry.file_size(ec);
            }
        }
        return total;
    }

    static std::string format_bytes(uint64_t bytes) {
        if (bytes < 1024) return std::to_string(bytes) + " B";
        if (bytes < 1024 * 1024) return std::to_string(bytes / 1024) + " KB";
        if (bytes < 1024ULL * 1024 * 1024) {
            char buf[32];
            snprintf(buf, sizeof(buf), "%.1f MB", (double)bytes / (1024.0 * 1024.0));
            return buf;
        }
        char buf[32];
        snprintf(buf, sizeof(buf), "%.2f GB", (double)bytes / (1024.0 * 1024.0 * 1024.0));
        return buf;
    }

    void SettingsPanel::render_storage(SettingsState& state) {
        const char* home = std::getenv("HOME");
        std::string cache_dir = home ? std::string(home) + "/misty/.cache" : "";
        std::string trash_dir = cache_dir + "/trash";
        std::string state_file = cache_dir + "/explorer_state.json";

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::Text("Storage & Cache");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::TextWrapped("Manage cached data, recent files, starred items, and trash.");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        // Cache info
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Cache Location");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::Text("%s", cache_dir.c_str());
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Spacing();

        // Style for action buttons
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(16.0f, 8.0f));

        // --- Clear Recent Files ---
        {
            auto& explorer = registry_.get_state<FileExplorerState>("Files");
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
            ImGui::Text("Recent Files");
            ImGui::PopStyleColor();
            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.45f, 1.0f));
            ImGui::Text("(%zu items)", explorer.recent_files.size());
            ImGui::PopStyleColor();
            ImGui::Spacing();

            if (!state.confirm_clear_recent) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
                if (ImGui::Button("Clear Recent Files", ImVec2(200, 0))) {
                    state.confirm_clear_recent = true;
                }
                ImGui::PopStyleColor(2);
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.8f, 0.3f, 1.0f));
                ImGui::Text("Are you sure?");
                ImGui::PopStyleColor();
                ImGui::SameLine();
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.7f, 0.25f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.85f, 0.3f, 0.25f, 1.0f));
                if (ImGui::Button("Yes, Clear##recent")) {
                    explorer.recent_files.clear();
                    explorer.dirty_ = true;
                    state.confirm_clear_recent = false;
                    state.status_message = "Recent files cleared.";
                    state.status_timer = 3.0f;
                }
                ImGui::PopStyleColor(2);
                ImGui::SameLine();
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
                if (ImGui::Button("Cancel##recent")) {
                    state.confirm_clear_recent = false;
                }
                ImGui::PopStyleColor(2);
            }
        }

        ImGui::Spacing();
        ImGui::Spacing();

        // --- Clear Starred Files ---
        {
            auto& explorer = registry_.get_state<FileExplorerState>("Files");
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
            ImGui::Text("Starred Files");
            ImGui::PopStyleColor();
            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.45f, 1.0f));
            ImGui::Text("(%zu items)", explorer.starred_files.size());
            ImGui::PopStyleColor();
            ImGui::Spacing();

            if (!state.confirm_clear_starred) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
                if (ImGui::Button("Clear Starred Files", ImVec2(200, 0))) {
                    state.confirm_clear_starred = true;
                }
                ImGui::PopStyleColor(2);
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.8f, 0.3f, 1.0f));
                ImGui::Text("Are you sure?");
                ImGui::PopStyleColor();
                ImGui::SameLine();
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.7f, 0.25f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.85f, 0.3f, 0.25f, 1.0f));
                if (ImGui::Button("Yes, Clear##starred")) {
                    explorer.starred_files.clear();
                    explorer.dirty_ = true;
                    state.confirm_clear_starred = false;
                    state.status_message = "Starred files cleared.";
                    state.status_timer = 3.0f;
                }
                ImGui::PopStyleColor(2);
                ImGui::SameLine();
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
                if (ImGui::Button("Cancel##starred")) {
                    state.confirm_clear_starred = false;
                }
                ImGui::PopStyleColor(2);
            }
        }

        ImGui::Spacing();
        ImGui::Spacing();

        // --- Empty Trash ---
        {
            auto& explorer = registry_.get_state<FileExplorerState>("Files");
            uint64_t trash_size = get_directory_size(trash_dir);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
            ImGui::Text("Trash");
            ImGui::PopStyleColor();
            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.45f, 1.0f));
            ImGui::Text("(%zu items, %s)", explorer.trash_files.size(), format_bytes(trash_size).c_str());
            ImGui::PopStyleColor();
            ImGui::Spacing();

            if (!state.confirm_empty_trash) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.15f, 0.15f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.2f, 0.2f, 1.0f));
                if (ImGui::Button("Empty Trash", ImVec2(200, 0))) {
                    state.confirm_empty_trash = true;
                }
                ImGui::PopStyleColor(2);
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.3f, 1.0f));
                ImGui::Text("This will permanently delete all trashed files!");
                ImGui::PopStyleColor();
                ImGui::SameLine();
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.7f, 0.15f, 0.15f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.85f, 0.2f, 0.2f, 1.0f));
                if (ImGui::Button("Yes, Delete All##trash")) {
                    // Remove files from disk
                    std::error_code ec;
                    if (fs::exists(trash_dir, ec)) {
                        fs::remove_all(trash_dir, ec);
                        fs::create_directories(trash_dir, ec);
                    }
                    explorer.trash_files.clear();
                    state.confirm_empty_trash = false;
                    state.status_message = "Trash emptied.";
                    state.status_timer = 3.0f;
                }
                ImGui::PopStyleColor(2);
                ImGui::SameLine();
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
                if (ImGui::Button("Cancel##trash")) {
                    state.confirm_empty_trash = false;
                }
                ImGui::PopStyleColor(2);
            }
        }

        ImGui::PopStyleVar(2); // frame rounding + padding
    }

    // ---------------------------------------------------------------
    // Cloud Services
    // ---------------------------------------------------------------
    void SettingsPanel::render_services(SettingsState& state) {
        auto& services = registry_.get_state<ServicesState>("Services");

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::Text("Cloud Services");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::TextWrapped("Manage connected cloud storage accounts and sync settings.");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(16.0f, 8.0f));

        // --- Auto Sync ---
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Background Sync");
        ImGui::PopStyleColor();
        ImGui::Spacing();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::TextWrapped("Automatically sync file status with cloud services in the background.");
        ImGui::PopStyleColor();
        ImGui::Spacing();
        ImGui::Checkbox("Enable auto-sync", &state.auto_sync_enabled);

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        // --- OneDrive accounts ---
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("OneDrive");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        {
            std::lock_guard<std::mutex> lock(services.mu);
            if (services.ms_connections.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.45f, 1.0f));
                ImGui::Text("No OneDrive accounts connected.");
                ImGui::PopStyleColor();
            } else {
                for (const auto& conn : services.ms_connections) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    ImGui::BeginChild(("##od_" + conn.profile.id).c_str(), ImVec2(0, 64), true,
                                      ImGuiWindowFlags_NoScrollbar);

                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
                    ImGui::Text("%s", conn.profile.display_name.c_str());
                    ImGui::PopStyleColor();

                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                    ImGui::Text("%s", conn.profile.email.c_str());
                    ImGui::PopStyleColor();

                    float btn_w = ImGui::CalcTextSize("Disconnect").x + 32.0f;
                    ImGui::SameLine(ImGui::GetContentRegionMax().x - btn_w);
                    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.15f, 0.15f, 1.0f));
                    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.2f, 0.2f, 1.0f));
                    if (ImGui::Button(("Disconnect##od_" + conn.profile.id).c_str())) {
                        services.disconnect_onedrive(conn.profile.id);
                    }
                    ImGui::PopStyleColor(2);

                    ImGui::EndChild();
                    ImGui::PopStyleVar();
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
            }
        }

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        // --- Google Drive accounts ---
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Google Drive");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        {
            std::lock_guard<std::mutex> lock(services.mu);
            if (services.gd_connections.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.45f, 1.0f));
                ImGui::Text("No Google Drive accounts connected.");
                ImGui::PopStyleColor();
            } else {
                for (const auto& conn : services.gd_connections) {
                    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));
                    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
                    ImGui::BeginChild(("##gd_" + conn.profile.id).c_str(), ImVec2(0, 64), true,
                                      ImGuiWindowFlags_NoScrollbar);

                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
                    ImGui::Text("%s", conn.profile.display_name.c_str());
                    ImGui::PopStyleColor();

                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
                    ImGui::Text("%s", conn.profile.email.c_str());
                    ImGui::PopStyleColor();

                    float btn_w = ImGui::CalcTextSize("Disconnect").x + 32.0f;
                    ImGui::SameLine(ImGui::GetContentRegionMax().x - btn_w);
                    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.15f, 0.15f, 1.0f));
                    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.2f, 0.2f, 1.0f));
                    if (ImGui::Button(("Disconnect##gd_" + conn.profile.id).c_str())) {
                        services.disconnect_gdrive(conn.profile.id);
                    }
                    ImGui::PopStyleColor(2);

                    ImGui::EndChild();
                    ImGui::PopStyleVar();
                    ImGui::PopStyleColor();
                    ImGui::Spacing();
                }
            }
        }

        ImGui::PopStyleVar(2);
    }

    // ---------------------------------------------------------------
    // Server
    // ---------------------------------------------------------------
    void SettingsPanel::render_server(SettingsState& state) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::Text("Server Connection");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::TextWrapped("Configure the gRPC server address and mount path used by the application.");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 8.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        // Connection Status
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Status");
        ImGui::PopStyleColor();
        ImGui::SameLine();
        if (state.server_connected) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.3f, 0.85f, 0.4f, 1.0f));
            ImGui::Text("Connected");
        } else {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.4f, 0.3f, 1.0f));
            ImGui::Text("Not Connected");
        }
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Spacing();

        // Mount Path
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Mount Path");
        ImGui::PopStyleColor();
        ImGui::Spacing();
        ImGui::SetNextItemWidth(320.0f);
        ImGui::InputText("##mount_path", state.mount_path, IM_ARRAYSIZE(state.mount_path));

        ImGui::Spacing();
        ImGui::Spacing();

        // Server Address
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Server Address");
        ImGui::PopStyleColor();
        ImGui::Spacing();
        ImGui::SetNextItemWidth(320.0f);
        ImGui::InputText("##server_address", state.server_address, IM_ARRAYSIZE(state.server_address));

        ImGui::PopStyleColor(); // FrameBg

        ImGui::Spacing();
        ImGui::Spacing();

        // Save button
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.45f, 0.8f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.55f, 0.9f, 1.0f));
        if (ImGui::Button("Save Configuration", ImVec2(200, 0))) {
            // Write misty.conf
            try {
                std::ofstream f("misty.conf");
                f << state.mount_path << "\n";
                f << state.server_address << "\n";
                f.close();
                state.status_message = "Configuration saved. Restart required.";
                state.status_timer = 4.0f;
            } catch (...) {
                state.status_message = "Failed to save configuration.";
                state.status_timer = 4.0f;
            }
        }
        ImGui::PopStyleColor(2);

        ImGui::PopStyleVar(2);
    }

    // ---------------------------------------------------------------
    // About
    // ---------------------------------------------------------------
    void SettingsPanel::render_about(SettingsState& state) {
        (void)state;

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::Text("About Misty");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::TextWrapped("A distributed file system with cloud storage integration.");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        auto label = [](const char* key, const char* value) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
            ImGui::Text("%s", key);
            ImGui::PopStyleColor();
            ImGui::SameLine(160);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
            ImGui::Text("%s", value);
            ImGui::PopStyleColor();
        };

        label("Application", "Misty");
        label("Version",     "1.0.0");
        label("Build",       __DATE__ " " __TIME__);
        label("Platform",
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
        label("C++ Standard", "C++20");

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
        ImGui::Text("Libraries");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
        ImGui::BulletText("Dear ImGui");
        ImGui::BulletText("GLFW + OpenGL");
        ImGui::BulletText("gRPC + Protobuf");
        ImGui::BulletText("nlohmann/json");
        ImGui::BulletText("LunaSVG");
        ImGui::BulletText("libcurl");
        ImGui::PopStyleColor();
    }

    // ---------------------------------------------------------------
    // Status Bar
    // ---------------------------------------------------------------
    void SettingsPanel::render_status_bar(SettingsState& state) {
        if (state.status_timer > 0.0f) {
            state.status_timer -= ImGui::GetIO().DeltaTime;

            float alpha = std::min(state.status_timer, 1.0f);
            ImGui::Spacing();
            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.3f, 0.85f, 0.5f, alpha));
            ImGui::Text("%s", state.status_message.c_str());
            ImGui::PopStyleColor();
        }
    }

} // namespace misty::panel
