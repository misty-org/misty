#include "file_sidebar_panel.h"

#include "core/manager/asset_manager.h"
#include "core/ui/ui_animate.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/remote_mount_state.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/navbar/navbar_state.h"
#include "panels/providers/state/providers_state.h"
#include "panels/providers/state/providers_state_util.h"
#include "views/app_view.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <nlohmann/json.hpp>
#include <string>
#include <utility>

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

    bool PlusButton(const char* id, bool expanded, float size = 18.0f) {
        ImGui::PushID(id);
        const bool clicked = ImGui::InvisibleButton("##plus", ImVec2(size, size));
        bool hovered = ImGui::IsItemHovered();
        bool active  = ImGui::IsItemActive();
        ImGui::PopID();

        ImVec2 p0 = ImGui::GetItemRectMin();
        const ImU32 col = active ? IM_COL32(255, 255, 255, 255)
                         : hovered ? IM_COL32(230, 236, 248, 255)
                                   : IM_COL32(205, 211, 224, 245);
        ImDrawList* dl = ImGui::GetWindowDrawList();
        constexpr float icon_size = 14.0f;
        const ImVec2 icon_min(p0.x + (size - icon_size) * 0.5f,
                              p0.y + (size - icon_size) * 0.5f);
        auto& icon = misty::core::AssetManager::get().get_svg_texture(
            expanded ? "chevron-down-16" : "chevron-right-16",
            static_cast<int>(icon_size));
        if (icon.id != 0) {
            dl->AddImage(icon.id,
                         icon_min,
                         ImVec2(icon_min.x + icon_size, icon_min.y + icon_size),
                         ImVec2(0, 0),
                         ImVec2(1, 1),
                         col);
        }

        return clicked;
    }

    std::string format_sidebar_bytes(std::uint64_t bytes) {
        static constexpr const char* kUnits[] = {"B", "KB", "MB", "GB", "TB"};
        double value = static_cast<double>(bytes);
        int unit = 0;
        while (value >= 1024.0 && unit < 4) {
            value /= 1024.0;
            ++unit;
        }

        char buf[32];
        if (unit == 0) {
            std::snprintf(buf, sizeof(buf), "%.0f %s", value, kUnits[unit]);
        } else if (value >= 100.0 || std::fabs(value - std::round(value)) < 0.05) {
            std::snprintf(buf, sizeof(buf), "%.0f %s", value, kUnits[unit]);
        } else {
            std::snprintf(buf, sizeof(buf), "%.1f %s", value, kUnits[unit]);
        }
        return buf;
    }

    std::vector<misty::panel::SidebarProviderEntry> parse_sidebar_provider_entries(const std::string& body) {
        using nlohmann::json;
        const json parsed = json::parse(body);
        std::vector<misty::panel::SidebarProviderEntry> entries;
        if (!parsed.is_array()) {
            return entries;
        }
        entries.reserve(parsed.size());
        for (const auto& item : parsed) {
            misty::panel::SidebarProviderEntry entry;
            entry.remote_name = item.value("name", std::string{});
            entry.provider_folder = item.value("type", std::string{});
            entry.label = entry.remote_name.empty() ? entry.provider_folder : entry.remote_name;
            entry.total_bytes = static_cast<std::uint64_t>(std::max<int64_t>(0, item.value("total_bytes", static_cast<int64_t>(0))));
            entry.free_bytes = static_cast<std::uint64_t>(std::max<int64_t>(0, item.value("free_bytes", static_cast<int64_t>(0))));
            entry.used_bytes = static_cast<std::uint64_t>(std::max<int64_t>(0, item.value("used_bytes", static_cast<int64_t>(0))));
            entry.capacity_known = item.value("capacity_known", false);
            if (!entry.remote_name.empty()) {
                entries.push_back(std::move(entry));
            }
        }
        return entries;
    }

    std::vector<misty::panel::SidebarProviderEntry> build_sidebar_provider_entries(
        const std::vector<misty::panel::ProviderRemote>& remotes) {
        std::vector<misty::panel::SidebarProviderEntry> entries;
        entries.reserve(remotes.size());
        for (const auto& remote : remotes) {
            misty::panel::SidebarProviderEntry entry;
            entry.provider_folder = remote.type.empty() ? "remote" : remote.type;
            entry.remote_name = remote.name;
            entry.label = remote.name.empty() ? entry.provider_folder : remote.name;
            if (!entry.remote_name.empty()) {
                entries.push_back(std::move(entry));
            }
        }
        return entries;
    }

    void merge_sidebar_provider_capacity(std::vector<misty::panel::SidebarProviderEntry>& entries,
                                         const std::vector<misty::panel::SidebarProviderEntry>& capacity_entries) {
        for (auto& entry : entries) {
            const auto it = std::find_if(capacity_entries.begin(), capacity_entries.end(), [&](const auto& candidate) {
                return candidate.remote_name == entry.remote_name &&
                       candidate.provider_folder == entry.provider_folder;
            });
            if (it == capacity_entries.end()) {
                continue;
            }
            entry.total_bytes = it->total_bytes;
            entry.free_bytes = it->free_bytes;
            entry.used_bytes = it->used_bytes;
            entry.capacity_known = it->capacity_known;
        }
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

    std::string workspace_label(const std::vector<misty::panel::FileSidebarPanel::WorkspaceEntry>& entries) {
        const auto it = std::find_if(entries.begin(), entries.end(), [](const auto& entry) {
            return entry.active;
        });
        if (it == entries.end()) {
            return entries.empty() ? "Workspace" : entries.front().title;
        }
        return it->title.empty() ? "Workspace" : it->title;
    }

    void draw_workspace_icon(ImDrawList* dl, ImVec2 min, ImU32 col) {
        const ImVec2 box_min(min.x + 2.0f, min.y + 6.0f);
        const ImVec2 box_max(min.x + 18.0f, min.y + 18.0f);
        dl->AddRect(box_min, box_max, col, 3.0f, 0, 1.8f);
        dl->AddRect(ImVec2(min.x + 7.0f, min.y + 3.0f), ImVec2(min.x + 13.0f, min.y + 7.0f), col, 2.0f, 0, 1.8f);
        dl->AddLine(ImVec2(box_min.x, box_min.y + 5.0f), ImVec2(box_max.x, box_min.y + 5.0f), col, 1.4f);
    }

    void draw_check_icon(ImDrawList* dl, ImVec2 min, ImU32 col) {
        dl->AddLine(ImVec2(min.x + 3.0f, min.y + 11.0f), ImVec2(min.x + 8.0f, min.y + 16.0f), col, 2.0f);
        dl->AddLine(ImVec2(min.x + 8.0f, min.y + 16.0f), ImVec2(min.x + 18.0f, min.y + 5.0f), col, 2.0f);
    }

    void draw_chevron_down(ImDrawList* dl, ImVec2 min, ImU32 col) {
        dl->AddLine(ImVec2(min.x + 4.0f, min.y + 7.0f), ImVec2(min.x + 10.0f, min.y + 13.0f), col, 2.0f);
        dl->AddLine(ImVec2(min.x + 10.0f, min.y + 13.0f), ImVec2(min.x + 16.0f, min.y + 7.0f), col, 2.0f);
    }

    bool asset_icon_button(const char* id,
                           ImVec2 pos,
                           ImVec2 size,
                           const char* icon_name,
                           ImU32 icon_col,
                           ImU32 hover_border_col) {
        const ImVec2 previous_cursor = ImGui::GetCursorScreenPos();
        ImGui::SetCursorScreenPos(pos);
        ImGui::PushID(id);
        const bool clicked = ImGui::InvisibleButton("##asset_icon", size);
        const bool hovered = ImGui::IsItemHovered();
        const bool active = ImGui::IsItemActive();
        ImGui::PopID();
        ImGui::SetCursorScreenPos(previous_cursor);

        ImDrawList* dl = ImGui::GetWindowDrawList();
        const ImVec2 max(pos.x + size.x, pos.y + size.y);
        if (hovered || active) {
            dl->AddRectFilled(pos, max, active ? IM_COL32(255, 255, 255, 30) : IM_COL32(255, 255, 255, 18), 6.0f);
            dl->AddRect(pos, max, hover_border_col, 6.0f, 0, 1.0f);
        }

        auto& icon = misty::core::AssetManager::get().get_svg_texture(icon_name, 18);
        if (icon.id != 0) {
            const ImVec2 icon_pos(pos.x + (size.x - 18.0f) * 0.5f, pos.y + (size.y - 18.0f) * 0.5f);
            dl->AddImage(icon.id,
                         icon_pos,
                         ImVec2(icon_pos.x + 18.0f, icon_pos.y + 18.0f),
                         ImVec2(0, 0),
                         ImVec2(1, 1),
                         icon_col);
        }
        return clicked;
    }
}

namespace misty::panel {
    namespace {
        constexpr ImVec4 kFileSidebarBg = ImVec4(0.075f, 0.085f, 0.10f, 1.0f);
        constexpr ImVec4 kFileSidebarSeparator = ImVec4(0.20f, 0.23f, 0.28f, 1.0f);
        constexpr int kSidebarProviderFetchAttempts = 4;
        constexpr auto kSidebarProviderFetchRetryDelay = std::chrono::milliseconds(500);
    }

    FileSidebarPanel::FileSidebarPanel(core::StateRegistry& registry, core::WorkerPool& worker_pool)
        : registry_(registry), worker_pool_(worker_pool) {
    }

    void FileSidebarPanel::render() {
        workspace_dropdown_open_ = false;
        auto& state = registry_.get_state<FileSidebarState>("FileSidebar");
        ensure_provider_entries_loaded(state);

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        ImGui::PushStyleColor(ImGuiCol_WindowBg, kFileSidebarBg);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 6.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, 8.0f);

        if (ImGui::Begin("FileSidebar", nullptr, flags)) {
            float width = ImGui::GetWindowWidth();
            float padding = std::clamp(width * 0.05f, 8.0f, 14.0f);
            
            
            ImGui::PushStyleColor(ImGuiCol_Separator, kFileSidebarSeparator);
            ImGui::SetCursorPosX(padding + 2.0f);
            ImGui::TextUnformatted("Workspace");
            ImGui::Dummy(ImVec2(0.0f, 2.0f));
            show_workspace_dropdown(width, padding);
            ImGui::Dummy(ImVec2(0.0f, 10.0f));
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
            show_workspace_name_modal();
            show_workspace_delete_modal();
        }

        ImGui::End();
        ImGui::PopStyleVar(4);
        ImGui::PopStyleColor();
    }

    void FileSidebarPanel::ensure_provider_entries_loaded(FileSidebarState& state) {
        {
            std::lock_guard<std::mutex> lock(state.providers_mutex);
            if (state.providers_loading || state.providers_loaded) {
                return;
            }
            state.providers_loading = true;
            state.providers_error.clear();
        }

        worker_pool_.add(
            [this, &state]() {
                const std::string list_url = providers_proxy_url("/api/remote");
                if (list_url.empty()) {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    state.providers_loading = false;
                    state.providers_loaded = true;
                    state.providers_error = "PROXY_SERVICE_URL not set";
                    return;
                }

                const auto list_fetch = fetch_providers_with_retries(
                    list_url,
                    kSidebarProviderFetchAttempts,
                    kSidebarProviderFetchRetryDelay,
                    {}
                );

                if (!list_fetch.success) {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    state.providers_loading = false;
                    state.providers_loaded = list_fetch.response.status_code != 401;
                    state.providers_last_refresh_at = std::chrono::steady_clock::now();
                    state.providers_error = list_fetch.last_error;
                    return;
                }

                std::vector<SidebarProviderEntry> entries =
                    build_sidebar_provider_entries(parse_provider_remotes(list_fetch.response.body));
                {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    state.provider_entries = entries;
                    state.providers_loaded = true;
                    state.providers_last_refresh_at = std::chrono::steady_clock::now();
                    state.providers_error.clear();
                }

                refresh_provider_capacity(state);
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

    void FileSidebarPanel::refresh_provider_entries(FileSidebarState& state) {
        {
            std::lock_guard<std::mutex> lock(state.providers_mutex);
            if (state.providers_loading) {
                return;
            }
            state.providers_loaded = false;
            state.providers_capacity_loaded = false;
            state.providers_capacity_loading = false;
            state.providers_error.clear();
        }
        ensure_provider_entries_loaded(state);
    }

    void FileSidebarPanel::refresh_provider_capacity(FileSidebarState& state) {
        {
            std::lock_guard<std::mutex> lock(state.providers_mutex);
            if (state.providers_capacity_loading) {
                state.providers_loading = false;
                return;
            }
            state.providers_capacity_loading = true;
            state.providers_loading = false;
        }

        worker_pool_.add(
            [this, &state]() {
                const std::string storage_url = providers_proxy_url("/api/remote/storage");
                if (storage_url.empty()) {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    state.providers_capacity_loading = false;
                    state.providers_capacity_loaded = true;
                    state.providers_error = "PROXY_SERVICE_URL not set";
                    return;
                }
                const auto storage_fetch = fetch_providers_with_retries(
                    storage_url,
                    kSidebarProviderFetchAttempts,
                    kSidebarProviderFetchRetryDelay,
                    {}
                );
                if (!storage_fetch.success) {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    state.providers_capacity_loading = false;
                    state.providers_capacity_loaded = true;
                    state.providers_error = storage_fetch.last_error;
                    return;
                }

                std::vector<SidebarProviderEntry> capacity_entries =
                    parse_sidebar_provider_entries(storage_fetch.response.body);
                {
                    std::lock_guard<std::mutex> lock(state.providers_mutex);
                    merge_sidebar_provider_capacity(state.provider_entries, capacity_entries);
                    state.providers_capacity_loading = false;
                    state.providers_capacity_loaded = true;
                    state.providers_error.clear();
                }
            },
            []() {},
            [&state](const std::string& err) {
                std::lock_guard<std::mutex> lock(state.providers_mutex);
                state.providers_capacity_loading = false;
                state.providers_capacity_loaded = true;
                state.providers_error = err;
            }
        );
    }

    void FileSidebarPanel::show_workspace_dropdown(float width, float padding) {
        if (!workspace_entries_provider_) {
            return;
        }

        std::vector<WorkspaceEntry> entries = workspace_entries_provider_();
        if (entries.empty()) {
            return;
        }

        const float content_width = width - (padding * 2);
        const float button_height = 34.0f;
        const std::string selected_label = workspace_label(entries);
        ImGui::SetCursorPosX(padding);
        const ImVec2 button_pos = ImGui::GetCursorScreenPos();
        ImGui::InvisibleButton("##workspace_dropdown_button", ImVec2(content_width, button_height));
        const bool button_hovered = ImGui::IsItemHovered();
        const bool button_clicked = ImGui::IsItemClicked(ImGuiMouseButton_Left);

        ImDrawList* dl = ImGui::GetWindowDrawList();
        const ImVec2 button_max(button_pos.x + content_width, button_pos.y + button_height);
        dl->AddRectFilled(button_pos, button_max, button_hovered ? IM_COL32(31, 37, 47, 255) : IM_COL32(25, 30, 38, 255), 7.0f);
        dl->AddRect(button_pos, button_max, IM_COL32(68, 76, 92, 170), 7.0f, 0, 1.0f);
        draw_workspace_icon(dl, ImVec2(button_pos.x + 9.0f, button_pos.y + 6.0f), IM_COL32(178, 185, 198, 235));
        dl->AddText(ImVec2(button_pos.x + 38.0f, button_pos.y + (button_height - ImGui::GetTextLineHeight()) * 0.5f),
                    IM_COL32(230, 235, 244, 245),
                    selected_label.c_str());
        draw_chevron_down(dl,
                          ImVec2(button_pos.x + content_width - 28.0f, button_pos.y + 8.0f),
                          IM_COL32(178, 185, 198, 235));
        if (button_clicked) {
            ImGui::OpenPopup("##workspace_dropdown_popup");
        }

        constexpr float popup_height = 238.0f;
        const float popup_width = std::max(content_width, 260.0f);
        ImGui::SetNextWindowPos(ImVec2(button_pos.x, button_max.y + 6.0f), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(popup_width, popup_height), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 4.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 8.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.07f, 0.085f, 0.105f, 0.98f));
        if (ImGui::BeginPopup("##workspace_dropdown_popup")) {
            workspace_dropdown_open_ = true;
            ImDrawList* popup_dl = ImGui::GetWindowDrawList();
            constexpr float row_height = 38.0f;
            for (const WorkspaceEntry& entry : entries) {
                const std::string title = entry.title.empty() ? "Workspace" : entry.title;
                const ImVec2 row_pos = ImGui::GetCursorScreenPos();
                const float popup_width = ImGui::GetContentRegionAvail().x;
                const float select_width = std::max(1.0f, popup_width - 76.0f);
                const ImVec2 row_max(row_pos.x + popup_width, row_pos.y + row_height);
                ImGui::PushID(entry.idx);
                ImGui::InvisibleButton("##workspace_row", ImVec2(select_width, row_height));
                const bool clicked = ImGui::IsItemClicked(ImGuiMouseButton_Left);
                ImGui::PopID();
                ImGui::SetCursorScreenPos(ImVec2(row_pos.x, row_pos.y + row_height + ImGui::GetStyle().ItemSpacing.y));

                const bool hovered = ImGui::IsMouseHoveringRect(row_pos, row_max, false);
                if (entry.active) {
                    popup_dl->AddRectFilled(row_pos, row_max, IM_COL32(25, 63, 108, 210), 7.0f);
                } else if (hovered) {
                    popup_dl->AddRectFilled(row_pos, row_max, IM_COL32(255, 255, 255, 18), 7.0f);
                }
                if (entry.active) {
                    draw_check_icon(popup_dl, ImVec2(row_pos.x + 8.0f, row_pos.y + 9.0f), IM_COL32(94, 160, 255, 255));
                }
                draw_workspace_icon(popup_dl,
                                    ImVec2(row_pos.x + 36.0f, row_pos.y + 8.0f),
                                    entry.active ? IM_COL32(112, 175, 255, 255) : IM_COL32(176, 184, 198, 230));
                ImGui::PushClipRect(ImVec2(row_pos.x + 64.0f, row_pos.y),
                                    ImVec2(row_pos.x + popup_width - 74.0f, row_pos.y + row_height),
                                    true);
                popup_dl->AddText(ImVec2(row_pos.x + 64.0f, row_pos.y + (row_height - ImGui::GetTextLineHeight()) * 0.5f),
                                  entry.active ? IM_COL32(112, 175, 255, 255) : IM_COL32(226, 231, 240, 245),
                                  title.c_str());
                ImGui::PopClipRect();

                bool consumed_action = false;
                if (hovered) {
                    const ImVec2 edit_pos(row_pos.x + popup_width - 68.0f, row_pos.y + 5.0f);
                    const ImVec2 trash_pos(row_pos.x + popup_width - 32.0f, row_pos.y + 5.0f);
                    if (asset_icon_button(("edit_" + std::to_string(entry.idx)).c_str(),
                                          edit_pos,
                                          ImVec2(28.0f, 28.0f),
                                          "pencil-16",
                                          IM_COL32(190, 198, 212, 240),
                                          IM_COL32(82, 92, 110, 210))) {
                        workspace_name_modal_is_rename_ = true;
                        workspace_name_modal_idx_ = entry.idx;
                        std::snprintf(workspace_name_buf_, sizeof(workspace_name_buf_), "%s", title.c_str());
                        show_workspace_name_modal_ = true;
                        consumed_action = true;
                        ImGui::CloseCurrentPopup();
                    }
                    if (asset_icon_button(("delete_" + std::to_string(entry.idx)).c_str(),
                                          trash_pos,
                                          ImVec2(28.0f, 28.0f),
                                          "x-circle-fill-16",
                                          IM_COL32(235, 99, 82, 245),
                                          IM_COL32(135, 62, 55, 220))) {
                        workspace_delete_modal_idx_ = entry.idx;
                        workspace_delete_modal_name_ = title;
                        show_workspace_delete_modal_ = true;
                        consumed_action = true;
                        ImGui::CloseCurrentPopup();
                    }
                }

                if (clicked && !consumed_action) {
                    if (workspace_select_handler_) {
                        workspace_select_handler_(entry.idx);
                    }
                    ImGui::CloseCurrentPopup();
                }
            }

            ImGui::Separator();
            const ImVec2 new_pos = ImGui::GetCursorScreenPos();
            const float popup_width = ImGui::GetContentRegionAvail().x;
            ImGui::InvisibleButton("##new_workspace", ImVec2(popup_width, row_height));
            const bool new_hovered = ImGui::IsItemHovered();
            const bool new_clicked = ImGui::IsItemClicked(ImGuiMouseButton_Left);
            if (new_hovered) {
                popup_dl->AddRectFilled(new_pos, ImVec2(new_pos.x + popup_width, new_pos.y + row_height), IM_COL32(255, 255, 255, 18), 7.0f);
            }
            popup_dl->AddText(ImVec2(new_pos.x + 42.0f, new_pos.y + (row_height - ImGui::GetTextLineHeight()) * 0.5f),
                              IM_COL32(214, 220, 232, 235),
                              "New Workspace");
            popup_dl->AddLine(ImVec2(new_pos.x + 18.0f, new_pos.y + 13.0f), ImVec2(new_pos.x + 18.0f, new_pos.y + 25.0f), IM_COL32(214, 220, 232, 235), 1.8f);
            popup_dl->AddLine(ImVec2(new_pos.x + 12.0f, new_pos.y + 19.0f), ImVec2(new_pos.x + 24.0f, new_pos.y + 19.0f), IM_COL32(214, 220, 232, 235), 1.8f);
            if (new_clicked) {
                workspace_name_modal_is_rename_ = false;
                workspace_name_modal_idx_ = -1;
                std::snprintf(workspace_name_buf_, sizeof(workspace_name_buf_), "New Workspace");
                show_workspace_name_modal_ = true;
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }

        ImGui::PopStyleColor();
        ImGui::PopStyleVar(3);
    }

    void FileSidebarPanel::show_workspace_name_modal() {
        if (show_workspace_name_modal_ || ImGui::IsPopupOpen("##workspace_name_modal")) {
            ImGui::GetIO().WantCaptureMouse = true;
            ImGui::GetIO().WantCaptureKeyboard = true;
        }

        if (show_workspace_name_modal_) {
            ImGui::OpenPopup("##workspace_name_modal");
        }

        ImGui::SetNextWindowSize(ImVec2(320.0f, 0.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(18.0f, 16.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.075f, 0.085f, 0.105f, 1.0f));
        if (ImGui::BeginPopupModal("##workspace_name_modal", nullptr,
                                   ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoTitleBar)) {
            ImGui::TextUnformatted(workspace_name_modal_is_rename_ ? "Rename Workspace" : "New Workspace");
            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            ImGui::SetNextItemWidth(-1.0f);
            const bool submitted = ImGui::InputTextWithHint("##workspace_name",
                                                            "Workspace name",
                                                            workspace_name_buf_,
                                                            sizeof(workspace_name_buf_),
                                                            ImGuiInputTextFlags_EnterReturnsTrue);
            ImGui::Dummy(ImVec2(0.0f, 10.0f));

            const auto empty_or_spaces = [](const char* text) {
                if (!text) return true;
                while (*text != '\0') {
                    if (!std::isspace(static_cast<unsigned char>(*text))) {
                        return false;
                    }
                    ++text;
                }
                return true;
            };
            const bool can_submit = !empty_or_spaces(workspace_name_buf_);
            const float button_w = 92.0f;
            ImGui::SetCursorPosX(ImGui::GetWindowWidth() - button_w * 2.0f - 28.0f);
            if (ImGui::Button("Cancel", ImVec2(button_w, 30.0f))) {
                show_workspace_name_modal_ = false;
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();
            if (!can_submit) {
                ImGui::BeginDisabled();
            }
            const bool ok_clicked = ImGui::Button(workspace_name_modal_is_rename_ ? "Rename" : "Create",
                                                  ImVec2(button_w, 30.0f));
            if (!can_submit) {
                ImGui::EndDisabled();
            }

            if ((submitted || ok_clicked) && can_submit) {
                if (workspace_name_modal_is_rename_) {
                    if (workspace_rename_handler_) {
                        workspace_rename_handler_(workspace_name_modal_idx_, workspace_name_buf_);
                    }
                } else if (workspace_create_handler_) {
                    workspace_create_handler_(workspace_name_buf_);
                }
                show_workspace_name_modal_ = false;
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

    void FileSidebarPanel::show_workspace_delete_modal() {
        if (show_workspace_delete_modal_ || ImGui::IsPopupOpen("##workspace_delete_modal")) {
            ImGui::GetIO().WantCaptureMouse = true;
            ImGui::GetIO().WantCaptureKeyboard = true;
        }

        if (show_workspace_delete_modal_) {
            ImGui::OpenPopup("##workspace_delete_modal");
        }

        ImGui::SetNextWindowSize(ImVec2(340.0f, 0.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(18.0f, 16.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.075f, 0.085f, 0.105f, 1.0f));
        if (ImGui::BeginPopupModal("##workspace_delete_modal", nullptr,
                                   ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoTitleBar)) {
            ImGui::TextUnformatted("Delete Workspace");
            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            ImGui::TextWrapped("Delete \"%s\"? This will remove its tabs and split layout.",
                               workspace_delete_modal_name_.empty() ? "Workspace" : workspace_delete_modal_name_.c_str());
            ImGui::Dummy(ImVec2(0.0f, 12.0f));

            const float button_w = 92.0f;
            ImGui::SetCursorPosX(ImGui::GetWindowWidth() - button_w * 2.0f - 28.0f);
            if (ImGui::Button("Cancel", ImVec2(button_w, 30.0f))) {
                show_workspace_delete_modal_ = false;
                workspace_delete_modal_idx_ = -1;
                workspace_delete_modal_name_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.48f, 0.16f, 0.14f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.62f, 0.20f, 0.17f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.42f, 0.12f, 0.11f, 1.0f));
            if (ImGui::Button("Delete", ImVec2(button_w, 30.0f))) {
                if (workspace_delete_handler_ && workspace_delete_modal_idx_ >= 0) {
                    workspace_delete_handler_(workspace_delete_modal_idx_);
                }
                show_workspace_delete_modal_ = false;
                workspace_delete_modal_idx_ = -1;
                workspace_delete_modal_name_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(3);

            ImGui::EndPopup();
        }
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }
    
    void FileSidebarPanel::show_providers_section(FileSidebarState& state, float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        const ImVec2 header_pos = ImGui::GetCursorScreenPos();
        if (SectionHeader("remote_hdr", "Remote", providers_collapsed_, content_width, false))
            providers_collapsed_ = !providers_collapsed_;
        const bool header_context_requested = ImGui::IsItemClicked(ImGuiMouseButton_Right);
        ImGui::SameLine();
        ImGui::SetCursorScreenPos(ImVec2(header_pos.x + content_width - 21.0f, header_pos.y));
        if (PlusButton("provider_add", !providers_collapsed_)) {
            registry_.get_state<NavbarState>("Navbar").selected_item = view::ViewID::Providers;
            auto& providers_state = registry_.get_state<ProvidersState>("Providers");
            providers_state.on_add_provider();
            view::switch_view(view::ViewID::Providers);
        }
        if (header_context_requested) {
            ImGui::OpenPopup("##remote_section_ctx");
        }
        if (ImGui::BeginPopup("##remote_section_ctx")) {
            if (ImGui::MenuItem("Refresh providers")) {
                refresh_provider_entries(state);
            }
            if (ImGui::MenuItem("Refresh storage")) {
                refresh_provider_capacity(state);
            }
            ImGui::EndPopup();
        }
        ImGui::SetCursorScreenPos(ImVec2(header_pos.x, header_pos.y + ImGui::GetTextLineHeight() + 5.0f));

        if (!providers_collapsed_) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 5.0f));

            std::vector<SidebarProviderEntry> entries;
            bool loading = false;
            bool capacity_loading = false;
            {
                std::lock_guard<std::mutex> lock(state.providers_mutex);
                entries = state.provider_entries;
                loading = state.providers_loading;
                capacity_loading = state.providers_capacity_loading;
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
                    const ImVec2 cursor = ImGui::GetCursorScreenPos();
                    constexpr float kRowHeight = 58.0f;
                    ImGui::PushID(entry.remote_name.c_str());
                    const bool pressed = ImGui::InvisibleButton("##remote", ImVec2(content_width, kRowHeight));
                    const bool hovered = ImGui::IsItemHovered();
                    const bool active = ImGui::IsItemActive();
                    const bool context_requested = ImGui::IsItemClicked(ImGuiMouseButton_Right);
                    ImDrawList* dl = ImGui::GetWindowDrawList();
                    if (hovered || active) {
                        const ImU32 row_col = active ? IM_COL32(255, 255, 255, 34) : IM_COL32(255, 255, 255, 20);
                        dl->AddRectFilled(cursor, ImVec2(cursor.x + content_width, cursor.y + kRowHeight), row_col, 7.0f);
                    }

                    constexpr float icon_size = 18.0f;
                    const ImVec2 icon_min(cursor.x + 10.0f, cursor.y + 11.0f);
                    auto& icon = provider_icon.empty()
                        ? misty::core::AssetManager::get().get_svg_texture("cloud-24", static_cast<int>(icon_size))
                        : misty::core::AssetManager::get().get_svg_texture_path(provider_icon, static_cast<int>(icon_size), false);
                    dl->AddImage(icon.id,
                                 icon_min,
                                 ImVec2(icon_min.x + icon_size, icon_min.y + icon_size),
                                 ImVec2(0, 0),
                                 ImVec2(1, 1),
                                 IM_COL32(255, 255, 255, 255));

                    const float text_x = cursor.x + 36.0f;
                    dl->AddText(ImVec2(text_x, cursor.y + 6.0f),
                                hovered || active ? IM_COL32(246, 248, 252, 255) : IM_COL32(230, 233, 240, 245),
                                entry.label.c_str());

                    std::string info = entry.provider_folder;
                    if (entry.capacity_known && entry.total_bytes > 0) {
                        const std::uint64_t used = std::min(entry.used_bytes, entry.total_bytes);
                        info = format_sidebar_bytes(used) + " / " + format_sidebar_bytes(entry.total_bytes) + " used";
                    }
                    if (capacity_loading && !entry.capacity_known) {
                        misty::UI::DrawMistyLoadingAnimation(
                            ImVec2(text_x, cursor.y + 22.0f),
                            ImVec2(text_x + 38.0f, cursor.y + 39.0f),
                            64.0f,
                            IM_COL32(0, 0, 0, 0));
                    } else {
                        dl->AddText(ImGui::GetFont(),
                                    ImGui::GetFontSize() * 0.85f,
                                    ImVec2(text_x, cursor.y + 25.0f),
                                    IM_COL32(164, 169, 181, 255),
                                    info.c_str());
                    }

                    if (entry.capacity_known && entry.total_bytes > 0) {
                        const std::uint64_t used = std::min(entry.used_bytes, entry.total_bytes);
                        const float fill = std::clamp(
                            static_cast<float>(used) / static_cast<float>(entry.total_bytes),
                            0.0f,
                            1.0f);
                        const float bar_x = text_x;
                        const float bar_y = cursor.y + 46.0f;
                        const float bar_w = std::max(20.0f, content_width - text_x + cursor.x - 12.0f);
                        dl->AddRectFilled(ImVec2(bar_x, bar_y),
                                          ImVec2(bar_x + bar_w, bar_y + 4.0f),
                                          IM_COL32(47, 51, 59, 255), 2.0f);
                        const ImU32 fill_col = IM_COL32(236, 239, 246, 245);
                        dl->AddRectFilled(ImVec2(bar_x, bar_y),
                                          ImVec2(bar_x + bar_w * fill, bar_y + 4.0f),
                                          fill_col, 2.0f);
                    }
                    if (context_requested) {
                        ImGui::OpenPopup("##remote_ctx");
                    }
                    if (ImGui::BeginPopup("##remote_ctx")) {
                        if (ImGui::MenuItem("Refresh storage")) {
                            refresh_provider_capacity(state);
                        }
                        ImGui::EndPopup();
                    }
                    ImGui::PopID();

                    if (pressed) {
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
                std::lock_guard<std::recursive_mutex> lock(explorer_state.mu);
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
