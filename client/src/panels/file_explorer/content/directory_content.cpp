#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/file_explorer/content/directory_content_util.h"
#include "panels/file_explorer/selection/drag_and_drop.h"

#include <chrono>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui_animate.h"
#include "core/ui/ui_layout.h"

namespace fs = std::filesystem;
using namespace misty::core;

namespace misty::panel {
namespace {

constexpr float kNameColumnWidth = 320.0f;
constexpr float kSizeColumnWidth = 96.0f;
constexpr float kTypeColumnWidth = 120.0f;
constexpr float kModifiedColumnWidth = 180.0f;
constexpr float kStateColumnWidth = 96.0f;
constexpr ImVec2 kTableCellPadding = ImVec2(8.0f, 6.0f);
constexpr float kTableMinInnerWidth =
    kNameColumnWidth + kSizeColumnWidth + kTypeColumnWidth +
    kModifiedColumnWidth + kStateColumnWidth;
constexpr UI::Spacing kGridCardPadding = UI::Spacing::sides(5.0f, 5.0f, 10.0f, 0.0f);
constexpr float kGridCardRounding = 6.0f;
constexpr float kGridIconSize = 32.0f;
constexpr float kGridLabelGap = 6.0f;
constexpr float kGridLabelWrapInset = 10.0f;

enum class FileTableColumn : int {
    Name = 0,
    Size = 1,
    Type = 2,
    LastModified = 3,
    State = 4,
};

} // namespace

void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
    static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
        ImGuiTableFlags_Hideable | ImGuiTableFlags_Resizable |
        ImGuiTableFlags_ScrollX |
        ImGuiTableFlags_SizingFixedFit;

    const bool loading = state.is_loading;
    const bool show_loading_animation = state.should_render_loading_animation(std::chrono::steady_clock::now());
    const bool show_empty_state = state.files.empty() && !loading && !show_loading_animation;
    const ImVec2 overlay_min = ImGui::GetCursorScreenPos();
    const ImVec2 overlay_size = ImGui::GetContentRegionAvail();
    const ImVec2 overlay_max(overlay_min.x + overlay_size.x, overlay_min.y + overlay_size.y);

    ImGuiIO& io = ImGui::GetIO();
    const bool active_text_edit = io.WantTextInput && ImGui::IsAnyItemActive();
    if (!loading && ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows) && !active_text_edit) {
        if (CommandManager::get().matches("explorer.refresh")) {
            std::string current(state.current_path);
            if (!current.empty()) {
                request_manual_refresh(state);
            }
        }
    }

    ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.45f, 0.45f, 0.45f, 0.45f));

    if (state.grid_view) {
        const float cell_w = 100.0f;
        const float cell_h = 104.0f;
        const float padding = 8.0f;

        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(padding, padding));
        if (show_empty_state) {
            render_empty_state(48.0f);
        } else if (!state.files.empty()) {
            float avail_w = ImGui::GetContentRegionAvail().x;
            int cols = std::max(1, static_cast<int>(avail_w / (cell_w + padding)));
            const float base_x = ImGui::GetCursorPosX();
            const float grid_width = cols * cell_w + std::max(0, cols - 1) * padding;
            const float side_padding = std::max(2.0f, (avail_w - grid_width) * 0.5f);
            for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                const int column = i % cols;
                if (column == 0) {
                    ImGui::SetCursorPosX(base_x + side_padding);
                } else {
                    ImGui::SameLine(0.0f, padding);
                }
                show_grid_item(state, i, cell_w, cell_h);
            }

            if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
                ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                !ImGui::IsAnyItemHovered()) {
                state.context_menu_target_path.clear();
                state.selected_files.clear();
                open_background_context_menu(state);
            }
        }
        ImGui::PopStyleVar();
    } else {
        const float table_inner_width = kTableMinInnerWidth;
        ImGui::PushStyleVar(ImGuiStyleVar_CellPadding, kTableCellPadding);
        if (ImGui::BeginTable("FileTable", 5, flags, ImVec2(0.0f, 0.0f), table_inner_width)) {
            ImGui::TableSetupScrollFreeze(0, 1);
            ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthFixed | ImGuiTableColumnFlags_DefaultSort,
                                    kNameColumnWidth);
            ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, kSizeColumnWidth);
            ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, kTypeColumnWidth);
            ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, kModifiedColumnWidth);
            ImGui::TableSetupColumn("State", ImGuiTableColumnFlags_WidthFixed, kStateColumnWidth);
            ImGui::TableHeadersRow();

            if (ImGuiTableSortSpecs* sorts_specs = ImGui::TableGetSortSpecs()) {
                if (sorts_specs->SpecsDirty || state.sort_dirty) {
                    sort_files(state, *sorts_specs);
                    sorts_specs->SpecsDirty = false;
                    state.sort_dirty = false;
                }
            }

            if (show_empty_state) {
                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);
                render_empty_state(40.0f);
            } else if (!state.files.empty()) {
                for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                    show_file_item(state, i);
                }
            }

            if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
                ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                !ImGui::IsAnyItemHovered()) {
                state.context_menu_target_path.clear();
                state.selected_files.clear();
                open_background_context_menu(state);
            }
            ImGui::EndTable();
        }
        ImGui::PopStyleVar();
    }

    if (!selection_detail::prominent_drag_target_hovered_this_frame() && !ImGui::IsAnyItemHovered()) {
        handle_file_drop_target(state, std::string(state.current_path), overlay_min, overlay_max, false, false);
    }
    selection_detail::draw_file_drag_preview(state, [&](const UnifiedFileItem& item) {
        return icon_name_for_file(state, item);
    });

    ImGui::PopStyleColor(3);

    if (show_loading_animation && overlay_size.x > 0.0f && overlay_size.y > 0.0f) {
        ImGui::SetCursorScreenPos(overlay_min);
        ImGui::InvisibleButton("##file_loading_blocker", overlay_size);
        misty::UI::DrawMistyLoadingAnimation(overlay_min, overlay_max);
    }

    show_rename_modal(state);
    show_new_entry_modal(state);
    show_permanent_delete_modal(state);
    show_permission_delete_modal(state);
}

void FileExplorerPanel::apply_table_sort(FileExplorerState& state, const ImGuiTableSortSpecs& sort_specs) {
    sort_files(state, sort_specs);
}

void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.id) > 0;

    float row_height = 32.0f;
    ImGui::TableNextRow(ImGuiTableRowFlags_None, row_height);
    ImGui::TableNextColumn();

    std::string label_id = "##row_" + file.id;

    ImVec2 p = ImGui::GetCursorScreenPos();
    if (ImGui::Selectable(label_id.c_str(), is_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick, ImVec2(0, row_height))) {
        select_item(state, file, i, is_selected, io);
    }
    const ImVec2 row_min = ImGui::GetItemRectMin();
    const ImVec2 row_max = ImGui::GetItemRectMax();

    if (ImGui::IsItemHovered() && !is_selected) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImU32 col_left = ImGui::IsItemActive() ? IM_COL32(255, 255, 255, 30) : IM_COL32(255, 255, 255, 20);
        ImU32 col_right = IM_COL32(255, 255, 255, 0);
        dl->AddRectFilledMultiColor(row_min, row_max, col_left, col_right, col_right, col_left);
    }

    if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
        state.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, file, i, false, io);
        open_context_menu(state);
    }

    begin_file_drag_source(state, file, i, is_selected);
    if (file.is_dir) {
        handle_file_drop_target(state,
                                file.path,
                                row_min,
                                row_max,
                                true,
                                true,
                                false);
    }
    const bool show_open_folder_icon = selection_detail::show_open_folder_for_drag_hover(file, row_min, row_max);

    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        }
    }

    float content_padding_y = (row_height - 16.0f) / 2.0f;
    ImVec2 icon_p = ImVec2(p.x + 4.0f, p.y + content_padding_y);
    ImGui::SetCursorScreenPos(icon_p);
    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(state, file, show_open_folder_icon), 16);
    if (icon.id != 0) {
        ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
        if (state.is_deleting(file.path)) {
            icon_col = IM_COL32(180, 180, 180, 210);
        }
        ImGui::GetWindowDrawList()->AddImage(icon.id, icon_p, ImVec2(icon_p.x + 16, icon_p.y + 16), ImVec2(0, 0), ImVec2(1, 1), icon_col);
    }
    ImGui::Dummy(ImVec2(16, 16));

    ImGui::SameLine(0, 8.0f);
    float text_y_offset = (row_height - ImGui::GetTextLineHeight()) / 2.0f;
    ImGui::SetCursorScreenPos(ImVec2(ImGui::GetCursorScreenPos().x, p.y + text_y_offset));
    if (state.is_deleting(file.path)) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.72f, 0.72f, 0.72f, 1.0f));
        ImGui::TextUnformatted(file.name.c_str());
        ImGui::PopStyleColor();
    } else {
        ImGui::TextUnformatted(file.name.c_str());
    }

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    render_file_size_cell(file);

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    ImGui::Text("%s", file.is_dir ? "Folder" : "File");

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    if (!file.last_modified.empty()) ImGui::Text("%s", file.last_modified.c_str());
    else ImGui::Text("-");

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    ImGui::TextUnformatted(state_label_for_item(state, file).c_str());

}

void FileExplorerPanel::show_grid_item(FileExplorerState& state, int i, float cell_w, float cell_h) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.id) > 0;

    ImVec2 cell_pos = ImGui::GetCursorScreenPos();
    std::string btn_id = "##grid_" + file.id;
    const bool clicked = begin_grid_item_button(btn_id, cell_w, cell_h);
    bool hovered = ImGui::IsItemHovered();
    bool double_clicked = hovered && ImGui::IsMouseDoubleClicked(0);

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 cell_max = ImVec2(cell_pos.x + cell_w, cell_pos.y + cell_h);
    dl->PushClipRect(cell_pos, cell_max, true);
    if (is_selected) {
        dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 40), kGridCardRounding);
    } else if (hovered) {
        dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 20), kGridCardRounding);
    }
    const bool show_open_folder_icon = selection_detail::show_open_folder_for_drag_hover(file, cell_pos, cell_max);
    grid_item_icon(dl, state, file, show_open_folder_icon, cell_pos, cell_w, kGridIconSize, kGridCardPadding.top);
    grid_item_label(dl, state, file, is_selected, cell_pos, cell_w, kGridIconSize, kGridCardPadding.top,
                    kGridLabelGap, kGridLabelWrapInset);
    dl->PopClipRect();

    if (clicked) select_item(state, file, i, is_selected, io);
    begin_file_drag_source(state, file, i, is_selected);
    if (file.is_dir) {
        handle_file_drop_target(state, file.path, cell_pos, cell_max, true, true, false);
    }

    if (double_clicked) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        }
    }

    if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
        state.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, file, i, false, io);
        open_context_menu(state);
    }
}


} // namespace misty::panel
