#include "panels/file_explorer/content/directory_content_util.h"

#include <algorithm>
#include <cctype>
#include <filesystem>

#include "core/manager/asset_manager.h"
#include "core/ui/ui_style.h"

namespace fs = std::filesystem;

namespace misty::panel {

int compare_strings(const std::string& lhs, const std::string& rhs) {
    std::string a = lhs;
    std::string b = rhs;
    std::transform(a.begin(), a.end(), a.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    std::transform(b.begin(), b.end(), b.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

std::string type_label_for_item(const UnifiedFileItem& file) {
    if (file.is_dir) return "folder";
    if (!file.mime_type.empty()) return file.mime_type;
    return fs::path(file.name).extension().string();
}

std::string state_label_for_item(const FileExplorerState& state, const UnifiedFileItem& file) {
    if (state.is_deleting(file.path)) return "DEL";
    return file.status == SyncStatus::DELETED ? "DEL" : "LOC";
}

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file, bool open_directory) {
    if (state.is_deleting(file.path)) return "trash-16";
    if (file.is_dir) return open_directory ? "file-directory-open-fill-24" : "file-directory-fill-16";

    const std::string ext = fs::path(file.name).extension().string();
    if (ext == ".cpp" || ext == ".h" || ext == ".hpp" || ext == ".c" || ext == ".cc" ||
        ext == ".js" || ext == ".ts" || ext == ".html" || ext == ".css" || ext == ".json" ||
        ext == ".py" || ext == ".go" || ext == ".rs" || ext == ".java") {
        return "file-code-16";
    }
    if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".svg" || ext == ".webp") {
        return "file-media-16";
    }
    if (ext == ".mp4" || ext == ".mov" || ext == ".avi" || ext == ".mkv") {
        return "video-16";
    }
    if (ext == ".zip" || ext == ".tar" || ext == ".gz" || ext == ".7z" || ext == ".rar") {
        return "file-zip-16";
    }
    return "file-16";
}

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file) {
    return icon_name_for_file(state, file, false);
}

ImU32 grid_item_icon_color(const FileExplorerState& state, const UnifiedFileItem& file) {
    if (state.is_deleting(file.path)) {
        return IM_COL32(180, 180, 180, 210);
    }
    return file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
}

ImU32 grid_item_text_color(const FileExplorerState& state, const UnifiedFileItem& file, bool is_selected) {
    if (state.is_deleting(file.path)) {
        return IM_COL32(170, 170, 174, 255);
    }
    return is_selected ? IM_COL32(255, 255, 255, 255) : IM_COL32(212, 212, 216, 255);
}

bool begin_grid_item_button(const std::string& id, float cell_w, float cell_h) {
    bool clicked = false;
    UI::WithStyle([&](UI::StyleScope& style) {
        style.var(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 0.0f));
        clicked = ImGui::InvisibleButton(id.c_str(), ImVec2(cell_w, cell_h));
    });
    return clicked;
}

void grid_item_icon(ImDrawList* draw_list,
                    const FileExplorerState& state,
                    const UnifiedFileItem& file,
                    bool show_open_folder_icon,
                    const ImVec2& cell_pos,
                    float cell_w,
                    float icon_size,
                    float padding_top) {
    const float icon_x = cell_pos.x + (cell_w - icon_size) * 0.5f;
    const float icon_y = cell_pos.y + padding_top;
    auto& icon = core::AssetManager::get().get_svg_texture(
        icon_name_for_file(state, file, show_open_folder_icon),
        static_cast<int>(icon_size));
    if (icon.id == 0) {
        return;
    }

    draw_list->AddImage(icon.id,
                        ImVec2(icon_x, icon_y),
                        ImVec2(icon_x + icon_size, icon_y + icon_size),
                        ImVec2(0, 0),
                        ImVec2(1, 1),
                        grid_item_icon_color(state, file));
}

void grid_item_label(ImDrawList* draw_list,
                     const FileExplorerState& state,
                     const UnifiedFileItem& file,
                     bool is_selected,
                     const ImVec2& cell_pos,
                     float cell_w,
                     float icon_size,
                     float padding_top,
                     float label_gap,
                     float wrap_inset) {
    const float text_y = cell_pos.y + padding_top + icon_size + label_gap;
    const float text_wrap_width = cell_w - wrap_inset;
    const ImVec2 name_size = ImGui::CalcTextSize(file.name.c_str(), nullptr, false, text_wrap_width);
    const float visible_text_width = std::min(name_size.x, text_wrap_width);
    const float text_x = cell_pos.x + (cell_w - visible_text_width) * 0.5f;

    draw_list->AddText(ImGui::GetFont(),
                       ImGui::GetFontSize(),
                       ImVec2(text_x, text_y),
                       grid_item_text_color(state, file, is_selected),
                       file.name.c_str(),
                       nullptr,
                       text_wrap_width);
}

void render_empty_state(float icon_size) {
    const float avail_h = ImGui::GetContentRegionAvail().y;
    const float avail_w = ImGui::GetContentRegionAvail().x;
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + avail_h * 0.3f);
    auto& folder_icon = core::AssetManager::get().get_svg_texture("file-directory-open-fill-24", static_cast<int>(icon_size));
    if (folder_icon.id) {
        ImGui::SetCursorPosX((avail_w - icon_size) * 0.5f);
        ImGui::Image(folder_icon.id, ImVec2(icon_size, icon_size));
        ImGui::Spacing();
    }
    const char* empty_label = "This folder is empty";
    const float label_w = ImGui::CalcTextSize(empty_label).x;
    ImGui::SetCursorPosX((avail_w - label_w) * 0.5f);
    ImGui::TextDisabled("%s", empty_label);
}

void select_item(FileExplorerState& state,
                 const UnifiedFileItem& file,
                 int index,
                 bool is_selected,
                 const ImGuiIO& io) {
    if (io.KeyCtrl) {
        if (is_selected) state.selected_files.erase(file.id);
        else state.selected_files.insert(file.id);
    } else if (io.KeyShift && state.last_selected_index != -1) {
        state.selected_files.clear();
        const int start = std::min(state.last_selected_index, index);
        const int end = std::max(state.last_selected_index, index);
        for (int item_index = start; item_index <= end; ++item_index) {
            state.selected_files.insert(state.files[item_index].id);
        }
    } else {
        state.selected_files.clear();
        state.selected_files.insert(file.id);
    }
    state.last_selected_index = index;
}

void sort_files(FileExplorerState& state, const ImGuiTableSortSpecs& sort_specs) {
    if (state.files.size() < 2 || sort_specs.SpecsCount <= 0 || sort_specs.Specs == nullptr) {
        return;
    }

    auto compare_for_column = [&state](const UnifiedFileItem& lhs,
                                       const UnifiedFileItem& rhs,
                                       ImGuiTableColumnSortSpecs spec) {
        int delta = 0;
        if (lhs.is_dir != rhs.is_dir) {
            delta = lhs.is_dir ? -1 : 1;
        } else {
            switch (static_cast<FileTableColumn>(spec.ColumnIndex)) {
                case FileTableColumn::Name:
                    delta = compare_strings(lhs.name, rhs.name);
                    break;
                case FileTableColumn::Size:
                    if (lhs.size < rhs.size) delta = -1;
                    else if (lhs.size > rhs.size) delta = 1;
                    break;
                case FileTableColumn::Type:
                    delta = compare_strings(type_label_for_item(lhs), type_label_for_item(rhs));
                    break;
                case FileTableColumn::LastModified:
                    delta = compare_strings(lhs.last_modified, rhs.last_modified);
                    break;
                case FileTableColumn::State:
                    delta = compare_strings(state_label_for_item(state, lhs), state_label_for_item(state, rhs));
                    break;
            }
        }
        if (delta == 0) {
            delta = compare_strings(lhs.name, rhs.name);
        }
        if (delta == 0) {
            delta = compare_strings(lhs.path, rhs.path);
        }
        if (spec.SortDirection == ImGuiSortDirection_Descending) {
            delta = -delta;
        }
        return delta;
    };

    std::stable_sort(state.files.begin(), state.files.end(),
        [&sort_specs, &compare_for_column](const UnifiedFileItem& lhs, const UnifiedFileItem& rhs) {
            for (int i = 0; i < sort_specs.SpecsCount; ++i) {
                const int delta = compare_for_column(lhs, rhs, sort_specs.Specs[i]);
                if (delta < 0) return true;
                if (delta > 0) return false;
            }
            return false;
        });
}

void render_file_size_cell(const UnifiedFileItem& file) {
    if (!file.is_dir && file.size > 0) {
        if (file.size < 1024) ImGui::Text("%lld B", file.size);
        else if (file.size < 1024 * 1024) ImGui::Text("%.1f KB", file.size / 1024.0);
        else if (file.size < 1024 * 1024 * 1024) ImGui::Text("%.1f MB", file.size / (1024.0 * 1024.0));
        else ImGui::Text("%.1f GB", file.size / (1024.0 * 1024.0 * 1024.0));
    } else {
        ImGui::Text("-");
    }
}

}  // namespace misty::panel
