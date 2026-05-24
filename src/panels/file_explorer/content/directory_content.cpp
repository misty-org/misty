#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/file_explorer/content/directory_content_util.h"
#include "panels/file_explorer/selection/drag_and_drop.h"

#include <chrono>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui_animate.h"
#include "core/ui/ui_layout.h"

using namespace misty::core;

namespace misty::panel {
namespace {

constexpr float kFileRowContentPaddingX = 8.0f;
constexpr float kFirstHeaderTextPaddingX = 8.0f;
constexpr float kDirectoryTablePaddingX = 2.0f;
constexpr float kNameColumnWidth = 360.0f;
constexpr float kModifiedColumnWidth = 220.0f;
constexpr float kSizeColumnWidth = 120.0f;
constexpr float kTypeColumnWidth = 140.0f;
constexpr ImVec2 kTableCellPadding = ImVec2(8.0f, 2.0f);
constexpr float kTableMinInnerWidth =
    kNameColumnWidth + kModifiedColumnWidth + kSizeColumnWidth + kTypeColumnWidth;


constexpr UI::Spacing kGridCardPadding = UI::Spacing::sides(5.0f, 5.0f, 10.0f, 0.0f);
constexpr float kGridCardRounding = 6.0f;
constexpr float kGridIconSize = 32.0f;
constexpr float kGridLabelGap = 6.0f;
constexpr float kGridLabelWrapInset = 10.0f;

bool is_downloadable_remote_file(const FileItem& file) {
    return file.type == FileType::REMOTE && !file.is_dir;
}

} // namespace

void FileExplorerPanel::show_directory_contents(FileExplorerState& state, FileListing& listing, FileExplorerPanel::TransientUiState& ui) {
    static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
        ImGuiTableFlags_Hideable | ImGuiTableFlags_Resizable |
        ImGuiTableFlags_ScrollX |
        ImGuiTableFlags_SizingFixedFit;

    const bool loading = listing.is_loading;
    const bool show_loading_animation = listing.loading.should_render(std::chrono::steady_clock::now());
    const bool show_empty_state = listing.files.empty() && !loading && !show_loading_animation;
    const ImVec2 overlay_min = ImGui::GetCursorScreenPos();
    const ImVec2 overlay_size = ImGui::GetContentRegionAvail();
    const float content_width = overlay_size.x;
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

    if (ui.grid_view) {
        const float cell_w = 100.0f;
        const float cell_h = 104.0f;
        const float padding = 8.0f;

        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(padding, padding));
        if (show_empty_state) {
            render_empty_state(48.0f);
        } else if (!listing.files.empty()) {
            float avail_w = content_width;
            int cols = std::max(1, static_cast<int>(avail_w / (cell_w + padding)));
            const float base_x = ImGui::GetCursorPosX();
            const float grid_width = cols * cell_w + std::max(0, cols - 1) * padding;
            const float side_padding = std::max(2.0f, (avail_w - grid_width) * 0.5f);
            for (int i = 0; i < static_cast<int>(listing.files.size()); ++i) {
                const int column = i % cols;
                if (column == 0) {
                    ImGui::SetCursorPosX(base_x + side_padding);
                } else {
                    ImGui::SameLine(0.0f, padding);
                }
                show_grid_item(state, listing, ui, i, cell_w, cell_h);
            }

            if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
                ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                !ImGui::IsAnyItemHovered()) {
                ui.context_menu_target_path.clear();
                ui.selected_files.clear();
                state.selected_files.clear();
                open_background_context_menu(state, ui);
            }
        }
        ImGui::PopStyleVar();
    } else {
        const float table_width = std::max(0.0f, content_width - kDirectoryTablePaddingX * 2.0f);
        const float table_inner_width = std::max(table_width, kTableMinInnerWidth);
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + kDirectoryTablePaddingX);
        UI::table("FileTable", {
            .columns = {
                {"Name", kNameColumnWidth,
                 ImGuiTableColumnFlags_WidthFixed | ImGuiTableColumnFlags_DefaultSort,
                 kFirstHeaderTextPaddingX},
                {"Modified", kModifiedColumnWidth, ImGuiTableColumnFlags_WidthFixed},
                {"Size", kSizeColumnWidth, ImGuiTableColumnFlags_WidthFixed},
                {"Kind", kTypeColumnWidth, ImGuiTableColumnFlags_WidthFixed},
            },
            .width = UI::Size::px(table_width),
            .inner_width = table_inner_width,
            .cell_padding = kTableCellPadding,
            .freeze_rows = 1,
            .flags = flags,
            .header_color = ImVec4(0.45f, 0.45f, 0.45f, 0.35f),
            .header_hovered_color = ImVec4(0.45f, 0.45f, 0.45f, 0.35f),
            .header_active_color = ImVec4(0.45f, 0.45f, 0.45f, 0.45f),
        }, [&](ImGuiTableSortSpecs* sorts_specs) {
            if (sorts_specs != nullptr) {
                if (sorts_specs->SpecsDirty || listing.sort_dirty) {
                    sort_files(listing, *sorts_specs);
                    sorts_specs->SpecsDirty = false;
                    listing.sort_dirty = false;
                }
            }

            if (show_empty_state) {
                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);
                render_empty_state(40.0f);
            } else if (!listing.files.empty()) {
                for (int i = 0; i < static_cast<int>(listing.files.size()); ++i) {
                    show_file_item(state, listing, ui, i);
                }
            }

            if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
                ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                !ImGui::IsAnyItemHovered()) {
                ui.context_menu_target_path.clear();
                ui.selected_files.clear();
                state.selected_files.clear();
                open_background_context_menu(state, ui);
            }
        });
    }

    if (!selection_detail::prominent_drag_target_hovered_this_frame() && !ImGui::IsAnyItemHovered()) {
        handle_file_drop_target(state, std::string(state.current_path), overlay_min, overlay_max, false, false);
    }
    selection_detail::draw_file_drag_preview(state, [&](const FileItem& item) {
        return icon_name_for_file(listing, item);
    });

    if (show_loading_animation && overlay_size.x > 0.0f && overlay_size.y > 0.0f) {
        ImGui::SetCursorScreenPos(overlay_min);
        ImGui::InvisibleButton("##file_loading_blocker", overlay_size);
        misty::UI::DrawMistyLoadingAnimation(overlay_min, overlay_max);
    }

    show_rename_modal(ui);
    show_new_entry_modal(ui);
    show_permanent_delete_modal(ui);
    show_permission_delete_modal(ui);
}

void FileExplorerPanel::apply_table_sort(FileExplorerState& state, FileListing& listing, FileExplorerPanel::TransientUiState& ui, const ImGuiTableSortSpecs& sort_specs) {
    sort_files(listing, sort_specs);
}

void FileExplorerPanel::show_file_item(FileExplorerState& state, FileListing& listing, FileExplorerPanel::TransientUiState& ui, int i) {
    ImGuiIO& io = ImGui::GetIO();
    const FileItem& file = listing.files[i];
    bool is_selected = ui.selected_files.count(file.id) > 0;

    float row_height = 32.0f;
    ImGui::TableNextRow(ImGuiTableRowFlags_None, row_height);
    ImGui::TableNextColumn();

    std::string label_id = "##row_" + file.id;

    ImVec2 p = ImGui::GetCursorScreenPos();
    const bool row_pressed = ImGui::Selectable(label_id.c_str(), is_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick, ImVec2(0, row_height));
    const bool row_double_clicked = ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(ImGuiMouseButton_Left);
    if (row_pressed) {
        select_item(state, ui, listing, file, i, is_selected, io);
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
        ui.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, ui, listing, file, i, false, io);
        open_context_menu(state, ui);
    }

    begin_file_drag_source(state, listing, ui, file, i, is_selected);
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

    if (row_double_clicked) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        } else if (is_downloadable_remote_file(file)) {
            download_remote_item(state, file);
            return;
        }
    }

    float content_padding_y = (row_height - 16.0f) / 2.0f;
    ImVec2 icon_p = ImVec2(p.x + kFileRowContentPaddingX, p.y + content_padding_y);
    ImGui::SetCursorScreenPos(icon_p);
    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(listing, file, show_open_folder_icon), 16);
    if (icon.id != 0) {
        ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
        if (listing.is_deleting(file.path)) {
            icon_col = IM_COL32(180, 180, 180, 210);
        }
        ImGui::GetWindowDrawList()->AddImage(icon.id, icon_p, ImVec2(icon_p.x + 16, icon_p.y + 16), ImVec2(0, 0), ImVec2(1, 1), icon_col);
    }
    ImGui::Dummy(ImVec2(16, 16));

    ImGui::SameLine(0, 8.0f);
    float text_y_offset = (row_height - ImGui::GetTextLineHeight()) / 2.0f;
    ImGui::SetCursorScreenPos(ImVec2(ImGui::GetCursorScreenPos().x, p.y + text_y_offset));
    if (listing.is_deleting(file.path)) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.72f, 0.72f, 0.72f, 1.0f));
        ImGui::TextUnformatted(file.name.c_str());
        ImGui::PopStyleColor();
    } else {
        ImGui::TextUnformatted(file.name.c_str());
    }

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    if (!file.last_modified.empty()) ImGui::Text("%s", file.last_modified.c_str());
    else ImGui::Text("-");

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    render_file_size_cell(file);

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    ImGui::Text("%s", file.is_dir ? "Folder" : "File");
    if (is_downloadable_remote_file(file)) {
        ImGui::SameLine(0.0f, 8.0f);
        auto& download_icon = AssetManager::get().get_svg_texture("download-16", 16);
        if (download_icon.id != 0) {
            const ImVec2 button_pos = ImGui::GetCursorScreenPos();
            if (ImGui::InvisibleButton(("##download_" + file.id).c_str(), ImVec2(18.0f, 18.0f))) {
                download_remote_item(state, file);
            }
            const ImU32 tint = ImGui::IsItemHovered()
                ? IM_COL32(235, 235, 238, 255)
                : IM_COL32(170, 175, 184, 255);
            ImGui::GetWindowDrawList()->AddImage(download_icon.id,
                                                  button_pos,
                                                  ImVec2(button_pos.x + 16.0f, button_pos.y + 16.0f),
                                                  ImVec2(0, 0),
                                                  ImVec2(1, 1),
                                                  tint);
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip("Download");
            }
        }
    }

}

void FileExplorerPanel::show_grid_item(FileExplorerState& state, FileListing& listing, FileExplorerPanel::TransientUiState& ui, int i, float cell_w, float cell_h) {
    ImGuiIO& io = ImGui::GetIO();
    const FileItem& file = listing.files[i];
    bool is_selected = ui.selected_files.count(file.id) > 0;

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
    grid_item_icon(dl, state, listing, file, show_open_folder_icon, cell_pos, cell_w, kGridIconSize, kGridCardPadding.top);
    grid_item_label(dl, state, listing, file, is_selected, cell_pos, cell_w, kGridIconSize, kGridCardPadding.top,
                    kGridLabelGap, kGridLabelWrapInset);
    dl->PopClipRect();

    if (clicked) select_item(state, ui, listing, file, i, is_selected, io);
    begin_file_drag_source(state, listing, ui, file, i, is_selected);
    if (file.is_dir) {
        handle_file_drop_target(state, file.path, cell_pos, cell_max, true, true, false);
    }

    if (double_clicked) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        } else if (file.type == FileType::REMOTE) {
            download_remote_item(state, file);
            return;
        }
    }

    if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
        ui.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, ui, listing, file, i, false, io);
        open_context_menu(state, ui);
    }
}


} // namespace misty::panel
