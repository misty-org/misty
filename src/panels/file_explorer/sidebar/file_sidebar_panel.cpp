#include "file_sidebar_panel.h"

#include "core/manager/asset_manager.h"
#include "core/manager/session_manager.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/remote_mount_state.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/navbar/navbar_state.h"
#include "panels/providers/state/providers_state.h"
#include "panels/providers/state/providers_state_util.h"
#include "views/app_view.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <string>

namespace fs = std::filesystem;

namespace {
    bool SamePath(const std::string& lhs, const std::string& rhs) {
        if (lhs == rhs) return true;
        if (lhs.empty() || rhs.empty()) return false;
        try {
            return fs::weakly_canonical(fs::path(lhs)) == fs::weakly_canonical(fs::path(rhs));
        } catch (...) {
            return fs::path(lhs).lexically_normal() == fs::path(rhs).lexically_normal();
        }
    }

    bool SectionHeader(const char* id, const char* label, bool collapsed, float width, bool show_chevron = true) {
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        float h = ImGui::GetTextLineHeight() + 5.0f;

        ImGui::PushID(id);
        bool clicked = ImGui::InvisibleButton("##hdr", ImVec2(width, h));
        ImGui::PopID();

        ImDrawList* dl = ImGui::GetWindowDrawList();

        dl->AddText(ImVec2(cursor.x + 2.0f, cursor.y + 1.0f),
                    IM_COL32(210, 214, 222, 255), label);

        if (show_chevron) {
            constexpr float icon_size = 14.0f;
            const ImVec2 icon_min(cursor.x + width - icon_size - 2.0f,
                                  cursor.y + (h - icon_size) * 0.5f);
            auto& icon = misty::core::AssetManager::get().get_svg_texture(
                collapsed ? "chevron-right-16" : "chevron-down-16",
                static_cast<int>(icon_size));
            dl->AddImage(icon.id,
                         icon_min,
                         ImVec2(icon_min.x + icon_size, icon_min.y + icon_size),
                         ImVec2(0, 0),
                         ImVec2(1, 1),
                         IM_COL32(225, 229, 238, 235));
        }

        return clicked;
    }

    bool PlusButton(const char* id, float size = 18.0f) {
        ImGui::PushID(id);
        const bool clicked = ImGui::InvisibleButton("##plus", ImVec2(size, size));
        bool hovered = ImGui::IsItemHovered();
        bool active  = ImGui::IsItemActive();
        ImGui::PopID();

        ImVec2 p0 = ImGui::GetItemRectMin();
        const float cx = p0.x + size * 0.5f;
        const float cy = p0.y + size * 0.5f;
        const ImU32 col = active ? IM_COL32(255, 255, 255, 255)
                         : hovered ? IM_COL32(230, 236, 248, 255)
                                   : IM_COL32(205, 211, 224, 245);
        ImDrawList* dl = ImGui::GetWindowDrawList();
        dl->AddLine(ImVec2(cx - 4.0f, cy), ImVec2(cx + 4.0f, cy), col, 1.7f);
        dl->AddLine(ImVec2(cx, cy - 4.0f), ImVec2(cx, cy + 4.0f), col, 1.7f);

        return clicked;
    }

    bool SidebarIconItem(const char* id,
                         const char* label,
                         const char* icon_name_or_path,
                         float width,
                         bool selected,
                         float height = 36.0f,
                         bool icon_path = false) {
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        ImVec2 item_size(width, height);

        ImGui::PushID(id);
        bool pressed = ImGui::InvisibleButton("##item", item_size);
        bool hovered = ImGui::IsItemHovered();
        bool active  = ImGui::IsItemActive();
        ImGui::PopID();

        ImDrawList* dl = ImGui::GetWindowDrawList();

        if (selected) {
            dl->AddRectFilled(cursor, ImVec2(cursor.x + item_size.x, cursor.y + item_size.y),
                              IM_COL32(39, 46, 65, 235), 7.0f);
        } else if (hovered || active) {
            const ImU32 row_col = active ? IM_COL32(255, 255, 255, 34) : IM_COL32(255, 255, 255, 20);
            dl->AddRectFilled(cursor, ImVec2(cursor.x + item_size.x, cursor.y + item_size.y),
                              row_col, 7.0f);
        }

        constexpr float icon_size = 18.0f;
        ImVec2 icon_min(cursor.x + 10.0f, cursor.y + (height - icon_size) * 0.5f);
        auto& icon = icon_path
            ? misty::core::AssetManager::get().get_svg_texture_path(
                icon_name_or_path,
                static_cast<int>(icon_size),
                false)
            : misty::core::AssetManager::get().get_svg_texture(icon_name_or_path, static_cast<int>(icon_size));
        dl->AddImage(icon.id, icon_min, ImVec2(icon_min.x + icon_size, icon_min.y + icon_size),
                     ImVec2(0, 0), ImVec2(1, 1),
                     icon_path
                         ? IM_COL32(255, 255, 255, 255)
                         : selected ? IM_COL32(145, 190, 255, 255) : IM_COL32(236, 239, 246, 245));

        ImVec2 text_pos(cursor.x + 36.0f, cursor.y + (height - ImGui::GetTextLineHeight()) * 0.5f);
        dl->AddText(text_pos,
                    selected ? IM_COL32(151, 194, 255, 255)
                             : (hovered || active ? IM_COL32(246, 248, 252, 255) : IM_COL32(230, 233, 240, 245)),
                    label);
        return pressed;
    }

    bool HoverListItem(const char* label, float width, float height = 28.0f) {
        return SidebarIconItem(label, label, "file-directory-24", width, false, height);
    }
}

namespace misty::panel {
    namespace {
        constexpr ImVec4 kFileSidebarBg = ImVec4(0.075f, 0.085f, 0.10f, 1.0f);
        constexpr ImVec4 kFileSidebarSeparator = ImVec4(0.20f, 0.23f, 0.28f, 1.0f);
        constexpr int kSidebarProviderFetchAttempts = 4;
        constexpr auto kSidebarProviderFetchRetryDelay = std::chrono::milliseconds(500);
        constexpr auto kSidebarProviderRefreshInterval = std::chrono::seconds(5);
    }

    FileSidebarPanel::FileSidebarPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool)
        : registry_(registry), worker_pool_(worker_pool) {
    }

    void FileSidebarPanel::render() {
        auto& state = registry_.get_state<FileSidebarState>("FileSidebar");
        ensure_provider_entries_loaded(state);

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::PushStyleColor(ImGuiCol_WindowBg, kFileSidebarBg);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 6.0f));

        if (ImGui::Begin("FileSidebar", nullptr, flags)) {
            float width = ImGui::GetWindowWidth();
            float padding = std::clamp(width * 0.05f, 8.0f, 14.0f);
            
            
            ImGui::PushStyleColor(ImGuiCol_Separator, kFileSidebarSeparator);
            show_quick_access(width, padding);
            ImGui::Dummy(ImVec2(0.0f, 12.0f));
            show_providers_section(state, width, padding);
            ImGui::Dummy(ImVec2(0.0f, 10.0f));
            show_devices_section(width, padding);
            ImGui::PopStyleColor();

      

            show_chooser_modal(state);
            show_create_entry_modal(state);
            show_uploader_modal(state);
            show_add_device_modal();
            show_device_rename_modal();
        }

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }

    void FileSidebarPanel::ensure_provider_entries_loaded(FileSidebarState& state) {
        const auto now = std::chrono::steady_clock::now();
        {
            std::lock_guard<std::mutex> lock(state.providers_mutex);
            const bool stale = state.providers_last_refresh_at == std::chrono::steady_clock::time_point{} ||
                               now - state.providers_last_refresh_at >= kSidebarProviderRefreshInterval;
            if (state.providers_loading || !stale) {
                return;
            }
            state.providers_loading = true;
            state.providers_last_refresh_at = now;
            state.providers_error.clear();
        }

        worker_pool_.add(
            [&state]() {
                const std::string url = providers_proxy_url("/api/remote");
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    state.providers_loading = false;
                    state.providers_loaded = true;
                    state.providers_error = "PROXY_SERVICE_URL not set";
                    return;
                }

                const auto fetch = fetch_providers_with_retries(
                    url,
                    kSidebarProviderFetchAttempts,
                    kSidebarProviderFetchRetryDelay,
                    core::SessionManager::get().get_auth_headers()
                );

                if (!fetch.success) {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    state.providers_loading = false;
                    state.providers_loaded = fetch.response.status_code != 401;
                    state.providers_last_refresh_at = std::chrono::steady_clock::now();
                    state.providers_error = fetch.last_error;
                    return;
                }

                std::vector<SidebarProviderEntry> entries;
                for (const auto& remote : parse_provider_remotes(fetch.response.body)) {
                    SidebarProviderEntry entry;
                    entry.provider_folder = remote.type.empty() ? "remote" : remote.type;
                    entry.remote_name = remote.name;
                    entry.label = remote.name.empty() ? entry.provider_folder : remote.name;
                    entries.push_back(std::move(entry));
                }

                std::lock_guard<std::mutex> lock(state.providers_mutex);
                state.provider_entries = std::move(entries);
                state.providers_loading = false;
                state.providers_loaded = true;
                state.providers_last_refresh_at = std::chrono::steady_clock::now();
                state.providers_error.clear();
            },
            []() {},
            [&state](const std::string& err) {
                std::lock_guard<std::mutex> lock(state.providers_mutex);
                state.providers_loading = false;
                state.providers_loaded = true;
                state.providers_last_refresh_at = std::chrono::steady_clock::now();
                state.providers_error = err;
            }
        );
    }
    
    void FileSidebarPanel::show_providers_section(FileSidebarState& state, float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        const ImVec2 header_pos = ImGui::GetCursorScreenPos();
        if (SectionHeader("remote_hdr", "Remote", providers_collapsed_, content_width, false))
            providers_collapsed_ = !providers_collapsed_;
        ImGui::SameLine();
        ImGui::SetCursorScreenPos(ImVec2(header_pos.x + content_width - 21.0f, header_pos.y));
        if (PlusButton("provider_add")) {
            registry_.get_state<NavbarState>("Navbar").selected_item = view::ViewID::Providers;
            auto& providers_state = registry_.get_state<ProvidersState>("Providers");
            providers_state.on_add_provider();
            view::switch_view(view::ViewID::Providers);
        }
        ImGui::SetCursorScreenPos(ImVec2(header_pos.x, header_pos.y + ImGui::GetTextLineHeight() + 5.0f));

        if (!providers_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 5.0f));

            std::vector<SidebarProviderEntry> entries;
            bool loading = false;
            {
                std::lock_guard<std::mutex> lock(state.providers_mutex);
                entries = state.provider_entries;
                loading = state.providers_loading;
            }

            if (entries.empty()) {
                ImGui::SetCursorPosX(padding + 4.0f);
                ImGui::TextDisabled("%s", loading ? "Loading remote..." : "No remotes connected");
            } else {
                for (const auto& entry : entries) {
                    const std::filesystem::path mount_path =
                        std::filesystem::path(get_mount_root()) /
                        entry.provider_folder /
                        entry.remote_name;

                    const std::string provider_icon = provider_logo_path_for_id(entry.provider_folder);
                    if (SidebarIconItem(entry.remote_name.c_str(),
                                        entry.label.c_str(),
                                        provider_icon.empty() ? "cloud-24" : provider_icon.c_str(),
                                        content_width,
                                        false,
                                        34.0f,
                                        !provider_icon.empty())) {
                        ensure_child_directory(RemoteMountChild{
                            RemoteMountParent{entry.provider_folder, entry.provider_folder, ""},
                            entry.remote_name,
                            entry.remote_name
                        });

                        if (navigation_handler_) {
                            navigation_handler_(mount_path.string());
                        }
                    }
                }
            }

            ImGui::PopStyleVar();
        }

        ImGui::EndGroup();

        ImGui::Spacing();
    }

    void FileSidebarPanel::show_local_section(float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        if (SectionHeader("local_hdr", "Local", local_collapsed_, content_width))
            local_collapsed_ = !local_collapsed_;

        if (!local_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 2.0f));

            const char* home = std::getenv("HOME");
            if (!home) {
                home = std::getenv("USERPROFILE");
            }

            if (home) {
                std::string home_path = home;

                if (HoverListItem("Home", content_width)) {
                    if (navigation_handler_) {
                        navigation_handler_(home_path);
                    }
                }

                std::string desktop_path = home_path + "/Desktop";
                if (fs::exists(desktop_path)) {
                    if (HoverListItem("Desktop", content_width)) {
                        if (navigation_handler_) {
                            navigation_handler_(desktop_path);
                        }
                    }
                }

                std::string documents_path = home_path + "/Documents";
                if (fs::exists(documents_path)) {
                    if (HoverListItem("Documents", content_width)) {
                        if (navigation_handler_) {
                            navigation_handler_(documents_path);
                        }
                    }
                }

                std::string downloads_path = home_path + "/Downloads";
                if (fs::exists(downloads_path)) {
                    if (HoverListItem("Downloads", content_width)) {
                        if (navigation_handler_) {
                            navigation_handler_(downloads_path);
                        }
                    }
                }

                std::string pictures_path = home_path + "/Pictures";
                if (fs::exists(pictures_path)) {
                    if (HoverListItem("Pictures", content_width)) {
                        if (navigation_handler_) {
                            navigation_handler_(pictures_path);
                        }
                    }
                }

                std::string music_path = home_path + "/Music";
                if (fs::exists(music_path)) {
                    if (HoverListItem("Music", content_width)) {
                        if (navigation_handler_) {
                            navigation_handler_(music_path);
                        }
                    }
                }

                std::string videos_path = home_path + "/Videos";
                if (fs::exists(videos_path)) {
                    if (HoverListItem("Videos", content_width)) {
                        if (navigation_handler_) {
                            navigation_handler_(videos_path);
                        }
                    }
                }
            }

            ImGui::PopStyleVar();
        }

        ImGui::EndGroup();

        ImGui::Spacing();
    }


    void FileSidebarPanel::show_quick_access(float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        if (SectionHeader("quick_access_hdr", "Quick access", quick_access_collapsed_, content_width, false))
            quick_access_collapsed_ = !quick_access_collapsed_;

        if (!quick_access_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 5.0f));

            std::string current_path;
            const std::string active_key = active_explorer_state_key_provider_ ? active_explorer_state_key_provider_() : "Files";
            auto& explorer_state = registry_.get_state<FileExplorerState>(active_key);
            {
                std::lock_guard<std::mutex> lock(explorer_state.mu);
                current_path = explorer_state.current_path;
            }

            const char* home_env = std::getenv("HOME");
            if (!home_env) {
                home_env = std::getenv("USERPROFILE");
            }
            if (home_env) {
                const std::string home_path = home_env;
                struct Shortcut {
                    const char* label;
                    const char* icon;
                    std::string path;
                };
                const std::vector<Shortcut> shortcuts = {
                    {"Home", "file-directory-open-fill-24", home_path},
                    {"Desktop", "devices-24", home_path + "/Desktop"},
                    {"Documents", "file-16", home_path + "/Documents"},
                    {"Downloads", "download-16", home_path + "/Downloads"},
                    {"Projects", "file-directory-24", home_path + "/Projects"},
                };

                for (const Shortcut& shortcut : shortcuts) {
                    const bool selected = SamePath(current_path, shortcut.path);
                    if (SidebarIconItem(shortcut.label, shortcut.label, shortcut.icon, content_width, selected)) {
                        if (navigation_handler_) {
                            navigation_handler_(shortcut.path);
                        }
                    }
                }
            }

            ImGui::PopStyleVar();
        }
        ImGui::EndGroup();
        
        // Add bottom padding for consistent spacing
        ImGui::Spacing();
    }



}
