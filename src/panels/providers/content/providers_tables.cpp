#include "panels/providers/content/providers_tables.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "core/manager/asset_manager.h"
#include "imgui.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/remote_mount_state.h"
#include "panels/navbar/navbar_state.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/content/providers_table_util.h"
#include "panels/providers/state/providers_state_util.h"
#include "views/app_view.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kPageBg(0.027f, 0.035f, 0.043f, 1.0f);
constexpr ImVec4 kCardBg(0.043f, 0.051f, 0.059f, 1.0f);
constexpr ImVec4 kCardBgAlt(0.060f, 0.069f, 0.078f, 1.0f);
constexpr ImVec4 kHeaderBg(0.071f, 0.082f, 0.094f, 1.0f);
constexpr ImVec4 kBorder(0.235f, 0.255f, 0.282f, 1.0f);
constexpr ImVec4 kText(0.945f, 0.933f, 0.910f, 1.0f);
constexpr ImVec4 kMuted(0.690f, 0.690f, 0.710f, 1.0f);
constexpr ImVec4 kAccent(0.318f, 0.710f, 0.655f, 1.0f);
constexpr ImVec4 kSuccess(0.475f, 0.729f, 0.561f, 1.0f);
constexpr ImVec4 kWarning(0.925f, 0.729f, 0.455f, 1.0f);
constexpr ImVec4 kDanger(0.894f, 0.373f, 0.373f, 1.0f);
constexpr ImVec4 kBlue(0.153f, 0.416f, 0.859f, 1.0f);
constexpr float kThinScrollbarSize = 8.0f;
constexpr float kRemoteRowHeight = 52.0f;
constexpr float kLogoSize = 24.0f;
constexpr float kRemoteTableMinWidth = 640.0f;
constexpr float kEditPaneMinContentWidth = 520.0f;
constexpr float kEditPaneMaxFormWidth = 760.0f;

std::string trim_middle(std::string value, std::size_t max_chars) {
    if (value.size() <= max_chars || max_chars < 8) {
        return value;
    }
    const std::size_t left = (max_chars - 3) / 2;
    const std::size_t right = max_chars - 3 - left;
    return value.substr(0, left) + "..." + value.substr(value.size() - right);
}

std::string config_value(const ProviderRemoteEditSession& session, const std::string& key) {
    const auto it = session.edit_config.find(key);
    return it == session.edit_config.end() ? std::string{} : it->second;
}

std::string provider_type_label(const ProviderCard& card) {
    return card.provider_id.empty() ? card.provider_label : card.provider_id;
}

std::string remote_path_hint(const ProviderCard& card, const ProviderRemoteEditSession& edit_session) {
    if (edit_session.has_selection &&
        (edit_session.selected_remote == card.id || edit_session.original_remote_name == card.id)) {
        const std::string root = config_value(edit_session, "root_folder_id");
        if (!root.empty()) {
            return root;
        }
        const std::string bucket = config_value(edit_session, "bucket");
        if (!bucket.empty()) {
            return bucket;
        }
        const std::string path = config_value(edit_session, "root");
        if (!path.empty()) {
            return path;
        }
    }
    return "/";
}

bool provider_has_error(const ProviderCard& card) {
    return card.needs_reconnect || card.unavailable || !card.connected;
}

std::string provider_status_text_for_card(const ProviderCard& card) {
    if (!card.status_label.empty()) {
        return card.status_label;
    }
    return providers_content::provider_status_text(card);
}

std::string last_checked_text(const ProviderCard& card, const ProviderRemoteEditSession& edit_session) {
    const bool selected = edit_session.has_selection &&
        (edit_session.selected_remote == card.id || edit_session.original_remote_name == card.id);
    if (!selected || edit_session.last_checked_unix <= 0) {
        return "--";
    }
    const std::int64_t now = static_cast<std::int64_t>(std::time(nullptr));
    const std::int64_t elapsed = std::max<std::int64_t>(0, now - edit_session.last_checked_unix);
    if (elapsed < 60) {
        return "just now";
    }
    if (elapsed < 3600) {
        return std::to_string(elapsed / 60) + "m ago";
    }
    return std::to_string(elapsed / 3600) + "h ago";
}

void draw_status_label(const ProviderCard& card) {
    const std::string status = provider_status_text_for_card(card);
    const ImVec4 color = card.needs_reconnect ? kWarning : (provider_has_error(card) ? kMuted : kSuccess);
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    ImGui::GetWindowDrawList()->AddCircleFilled(
        ImVec2(cursor.x + 4.0f, cursor.y + ImGui::GetTextLineHeight() * 0.5f),
        3.5f,
        ImGui::GetColorU32(color));
    ImGui::SetCursorScreenPos(ImVec2(cursor.x + 16.0f, cursor.y));
    ImGui::PushStyleColor(ImGuiCol_Text, color);
    ImGui::TextUnformatted(status.c_str());
    ImGui::PopStyleColor();
}

void draw_status_pill(const ProviderCard& card) {
    const std::string label = provider_status_text_for_card(card);
    const ImVec4 text = card.needs_reconnect ? kWarning : (provider_has_error(card) ? kMuted : kSuccess);
    const ImVec4 bg = card.needs_reconnect ? ImVec4(0.19f, 0.14f, 0.07f, 1.0f) : ImVec4(0.06f, 0.18f, 0.11f, 1.0f);
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 text_size = ImGui::CalcTextSize(label.c_str());
    const ImVec2 size(text_size.x + 28.0f, 22.0f);
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(bg), 5.0f);
    draw_list->AddCircleFilled(ImVec2(pos.x + 10.0f, pos.y + size.y * 0.5f), 3.5f, ImGui::GetColorU32(text));
    draw_list->AddText(ImVec2(pos.x + 19.0f, pos.y + (size.y - text_size.y) * 0.5f), ImGui::GetColorU32(text), label.c_str());
    ImGui::Dummy(size);
}

bool icon_button(const char* id, const char* icon_name, const char* tooltip, const ImVec2& size, ImVec4 tint = kText, bool danger = false) {
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const bool pressed = ImGui::InvisibleButton(id, size);
    const bool hovered = ImGui::IsItemHovered();
    const ImVec4 bg = hovered ? ImVec4(0.094f, 0.094f, 0.106f, 1.0f) : kCardBgAlt;
    const ImVec4 border = danger ? ImVec4(0.42f, 0.14f, 0.14f, 1.0f) : kBorder;
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(bg), 8.0f);
    draw_list->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(border), 8.0f);

    auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 24);
    if (icon.id != 0) {
        const float icon_size = 18.0f;
        const ImVec2 icon_pos(pos.x + (size.x - icon_size) * 0.5f, pos.y + (size.y - icon_size) * 0.5f);
        draw_list->AddImage(icon.id,
                            icon_pos,
                            ImVec2(icon_pos.x + icon_size, icon_pos.y + icon_size),
                            ImVec2(0.0f, 0.0f),
                            ImVec2(1.0f, 1.0f),
                            ImGui::GetColorU32(danger ? kDanger : tint));
    }
    if (hovered && tooltip) {
        ImGui::SetTooltip("%s", tooltip);
    }
    return pressed;
}

bool action_button(const char* label,
                   const char* icon_name,
                   const ImVec2& size,
                   ImVec4 bg,
                   ImVec4 hover,
                   ImVec4 text) {
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    ImGui::PushStyleColor(ImGuiCol_Button, bg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, hover);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, bg);
    ImGui::PushStyleColor(ImGuiCol_Text, text);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
    const bool pressed = ImGui::Button(("##" + std::string(label)).c_str(), size);
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(4);

    auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 18);
    const float icon_size = 16.0f;
    const float gap = icon.id != 0 ? 9.0f : 0.0f;
    const ImVec2 text_size = ImGui::CalcTextSize(label);
    const float total = (icon.id != 0 ? icon_size : 0.0f) + gap + text_size.x;
    float x = pos.x + (size.x - total) * 0.5f;
    if (icon.id != 0) {
        const float y = pos.y + (size.y - icon_size) * 0.5f;
        ImGui::GetWindowDrawList()->AddImage(icon.id,
                                             ImVec2(x, y),
                                             ImVec2(x + icon_size, y + icon_size),
                                             ImVec2(0.0f, 0.0f),
                                             ImVec2(1.0f, 1.0f),
                                             ImGui::GetColorU32(text));
        x += icon_size + gap;
    }
    ImGui::GetWindowDrawList()->AddText(ImVec2(x, pos.y + (size.y - text_size.y) * 0.5f),
                                        ImGui::GetColorU32(text),
                                        label);
    return pressed;
}

bool segmented_tab_button(const char* id, const char* label, bool active, const ImVec2& size) {
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const bool pressed = ImGui::InvisibleButton(id, size);
    const bool hovered = ImGui::IsItemHovered();
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const ImVec4 bg = active
        ? ImVec4(0.086f, 0.188f, 0.188f, 1.0f)
        : (hovered ? ImVec4(0.072f, 0.083f, 0.095f, 1.0f) : ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
    if (active || hovered) {
        draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(bg), 7.0f);
    }
    if (active) {
        draw_list->AddRect(pos,
                           ImVec2(pos.x + size.x, pos.y + size.y),
                           ImGui::GetColorU32(ImVec4(0.165f, 0.392f, 0.369f, 1.0f)),
                           7.0f,
                           0,
                           1.0f);
    }
    const ImVec2 text_size = ImGui::CalcTextSize(label);
    const ImVec4 text = active ? kAccent : kText;
    draw_list->AddText(ImVec2(pos.x + (size.x - text_size.x) * 0.5f,
                              pos.y + (size.y - text_size.y) * 0.5f),
                       ImGui::GetColorU32(text),
                       label);
    return pressed;
}

void render_page_toolbar(ProvidersState& state, ProvidersPageTab selected_tab, float available_width) {
    const float start_x = ImGui::GetCursorPosX();
    const float toolbar_width = std::min(390.0f, std::max(260.0f, available_width));
    const float toolbar_height = 48.0f;
    const float x = std::max(0.0f, (available_width - toolbar_width) * 0.5f);
    ImGui::SetCursorPosX(start_x + x);

    const ImVec2 pos = ImGui::GetCursorScreenPos();
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(pos,
                             ImVec2(pos.x + toolbar_width, pos.y + toolbar_height),
                             ImGui::GetColorU32(kCardBgAlt),
                             9.0f);
    draw_list->AddRect(pos,
                       ImVec2(pos.x + toolbar_width, pos.y + toolbar_height),
                       ImGui::GetColorU32(kBorder),
                       9.0f,
                       0,
                       1.0f);

    ImGui::SetCursorScreenPos(ImVec2(pos.x + 4.0f, pos.y + 4.0f));
    const float tab_width = (toolbar_width - 8.0f) * 0.5f;
    if (segmented_tab_button("##providers_tab_remotes", "Remotes", selected_tab == ProvidersPageTab::Remotes, ImVec2(tab_width, toolbar_height - 8.0f))) {
        state.set_page_tab(ProvidersPageTab::Remotes);
    }
    ImGui::SameLine(0.0f, 0.0f);
    if (segmented_tab_button("##providers_tab_diagnostics", "Diagnostics", selected_tab == ProvidersPageTab::Diagnostics, ImVec2(tab_width, toolbar_height - 8.0f))) {
        state.set_page_tab(ProvidersPageTab::Diagnostics);
    }
    ImGui::SetCursorScreenPos(ImVec2(pos.x, pos.y + toolbar_height));
    ImGui::Dummy(ImVec2(toolbar_width, 1.0f));
    ImGui::SetCursorPosX(start_x);
}

void open_provider_remote(core::StateRegistry& registry, const ProviderCard& card) {
    ensure_child_directory(RemoteMountChild{
        RemoteMountParent{card.provider_id, card.provider_id, ""},
        card.id,
        card.id,
    });

    const std::string path = (std::filesystem::path(get_mount_root()) / card.provider_id / card.id).string();
    auto& explorer_state = registry.get_state<FileExplorerState>("Files");
    std::snprintf(explorer_state.current_path, sizeof(explorer_state.current_path), "%s", path.c_str());
    std::snprintf(explorer_state.search_path, sizeof(explorer_state.search_path), "%s", path.c_str());
    registry.get_state<NavbarState>("Navbar").selected_item = view::ViewID::Files;
    view::switch_view(view::ViewID::Files);
}

void draw_section_title(const char* label, std::size_t count) {
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::SetWindowFontScale(1.08f);
    ImGui::TextUnformatted(label);
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopStyleColor();
    ImGui::SameLine(0.0f, 10.0f);

    char count_text[32];
    std::snprintf(count_text, sizeof(count_text), "%zu", count);
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 text_size = ImGui::CalcTextSize(count_text);
    const ImVec2 size(text_size.x + 14.0f, 22.0f);
    ImGui::GetWindowDrawList()->AddCircleFilled(ImVec2(pos.x + size.x * 0.5f, pos.y + size.y * 0.5f),
                                                size.y * 0.5f,
                                                ImGui::GetColorU32(ImVec4(0.12f, 0.13f, 0.15f, 1.0f)));
    ImGui::GetWindowDrawList()->AddCircle(ImVec2(pos.x + size.x * 0.5f, pos.y + size.y * 0.5f),
                                          size.y * 0.5f,
                                          ImGui::GetColorU32(kBorder));
    ImGui::GetWindowDrawList()->AddText(ImVec2(pos.x + (size.x - text_size.x) * 0.5f,
                                               pos.y + (size.y - text_size.y) * 0.5f),
                                        ImGui::GetColorU32(kMuted),
                                        count_text);
    ImGui::Dummy(size);
}

void draw_remote_more_menu(core::StateRegistry& registry, ProvidersState& state, const ProviderCard& card) {
    if (!ImGui::BeginPopup("##provider_more_actions")) {
        return;
    }
    if (ImGui::MenuItem("Open remote")) {
        open_provider_remote(registry, card);
    }
    if (ImGui::MenuItem("Refresh status")) {
        state.refresh_remote_statuses();
    }
    if (ImGui::MenuItem("Edit remote")) {
        state.show_edit_panel();
        state.select_remote(card.id);
    }
    ImGui::Separator();
    if (card.needs_reconnect && ImGui::MenuItem("Reconnect")) {
        state.on_request_reconnect(card.id);
    } else if (card.unavailable && ImGui::MenuItem("Configure")) {
        state.on_request_repair(card.id);
    }
    if (ImGui::MenuItem("Disconnect")) {
        state.on_request_disconnect(card.id);
    }
    ImGui::EndPopup();
}

void render_remote_row(core::StateRegistry& registry,
                       ProvidersState& state,
                       const ProviderCard& card,
                       const ProviderRemoteEditSession& edit_session,
                       bool edit_panel_visible) {
    ImGui::PushID(card.id.c_str());
    ImGui::TableNextRow(ImGuiTableRowFlags_None, kRemoteRowHeight);
    ImGui::TableSetColumnIndex(0);

    const ImVec2 row_start = ImGui::GetCursorScreenPos();
    const float row_right = ImGui::GetWindowPos().x + ImGui::GetWindowContentRegionMax().x;
    const ImVec2 row_min(row_start.x - ImGui::GetStyle().CellPadding.x, row_start.y - ImGui::GetStyle().CellPadding.y);
    const ImVec2 row_max(row_right, row_min.y + kRemoteRowHeight);
    const bool hovered = ImGui::IsMouseHoveringRect(row_min, row_max);
    const bool selected = edit_session.has_selection &&
        (edit_session.selected_remote == card.id || edit_session.original_remote_name == card.id);
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    if (selected || hovered) {
        const ImVec4 row_bg = selected
            ? ImVec4(0.080f, 0.104f, 0.112f, 1.0f)
            : ImVec4(1.0f, 1.0f, 1.0f, 0.035f);
        draw_list->AddRectFilled(row_min, row_max, ImGui::GetColorU32(row_bg), 0.0f);
    }
    draw_list->AddLine(ImVec2(row_min.x, row_max.y - 1.0f),
                       ImVec2(row_max.x, row_max.y - 1.0f),
                       ImGui::GetColorU32(ImVec4(0.115f, 0.127f, 0.139f, 1.0f)),
                       1.0f);
    if (hovered) {
        ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
    }

    const ImVec2 selectable_pos = ImGui::GetCursorScreenPos();
    if (ImGui::Selectable("##select_remote", false, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowOverlap, ImVec2(0.0f, kRemoteRowHeight - 1.0f)) &&
        edit_panel_visible) {
        state.select_remote(card.id);
    }
    ImGui::SetCursorScreenPos(selectable_pos);

    ImGui::SetCursorScreenPos(ImVec2(row_min.x + 12.0f, row_min.y + (kRemoteRowHeight - kLogoSize) * 0.5f));
    draw_provider_logo(card, kLogoSize);
    ImGui::SetCursorScreenPos(ImVec2(row_min.x + 42.0f, row_min.y + 17.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::TextUnformatted(trim_middle(card.id, 20).c_str());
    ImGui::PopStyleColor();
    if (ImGui::IsItemHovered() && card.id.size() > 20) {
        ImGui::SetTooltip("%s", card.id.c_str());
    }

    ImGui::TableSetColumnIndex(1);
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 12.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(provider_type_label(card).c_str());
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(2);
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 12.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(trim_middle(remote_path_hint(card, edit_session), 20).c_str());
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(3);
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 12.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(last_checked_text(card, edit_session).c_str());
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(4);
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 12.0f);
    draw_status_label(card);
    if (provider_has_error(card) && ImGui::IsItemHovered()) {
        const std::string tooltip = card.status_detail.empty() ? provider_status_text_for_card(card) : card.status_detail;
        ImGui::SetTooltip("%s", tooltip.c_str());
    }

    ImGui::TableSetColumnIndex(5);
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 11.0f);
    if (icon_button("##edit", "pencil-16", "Edit remote", ImVec2(28.0f, 28.0f), kText)) {
        state.show_edit_panel();
        state.select_remote(card.id);
    }
    ImGui::SameLine(0.0f, 5.0f);
    if (icon_button("##more", "kebab-horizontal-24", "More actions", ImVec2(28.0f, 28.0f), kText)) {
        ImGui::OpenPopup("##provider_more_actions");
    }
    draw_remote_more_menu(registry, state, card);

    ImGui::PopID();
}

void render_remote_table(core::StateRegistry& registry,
                         ProvidersState& state,
                         const std::vector<ProviderCard>& cards,
                         const ProviderRemoteEditSession& edit_session,
                         bool edit_panel_visible,
                         float width,
                         float height) {
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, kThinScrollbarSize);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

    if (ImGui::BeginChild("##providers_remotes_panel", ImVec2(width, height), true)) {
        ImGui::SetCursorPos(ImVec2(18.0f, 16.0f));
        draw_section_title("Remotes", cards.size());
        ImGui::Dummy(ImVec2(0.0f, 9.0f));

        if (cards.empty()) {
            ImGui::SetCursorPosX(18.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextWrapped("No remotes match this search.");
            ImGui::PopStyleColor();
        } else {
            const ImGuiTableFlags flags =
                ImGuiTableFlags_Resizable |
                ImGuiTableFlags_Reorderable |
                ImGuiTableFlags_ScrollX |
                ImGuiTableFlags_ScrollY |
                ImGuiTableFlags_SizingFixedFit;
            ImGui::PushStyleColor(ImGuiCol_TableHeaderBg, ImVec4(0.078f, 0.089f, 0.101f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.095f, 0.108f, 0.122f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.104f, 0.119f, 0.134f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_TableBorderStrong, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_TableBorderLight, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_CellPadding, ImVec2(7.0f, 6.0f));
            const float table_height = std::max(120.0f, ImGui::GetContentRegionAvail().y - 50.0f);
            if (ImGui::BeginTable("##providers_remote_table_compact", 6, flags, ImVec2(0.0f, table_height), kRemoteTableMinWidth)) {
                ImGui::TableSetupColumn("Remote", ImGuiTableColumnFlags_WidthFixed, 172.0f);
                ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 78.0f);
                ImGui::TableSetupColumn("Path", ImGuiTableColumnFlags_WidthFixed, 92.0f);
                ImGui::TableSetupColumn("Last Checked", ImGuiTableColumnFlags_WidthFixed, 100.0f);
                ImGui::TableSetupColumn("Status", ImGuiTableColumnFlags_WidthFixed, 112.0f);
                ImGui::TableSetupColumn("", ImGuiTableColumnFlags_WidthFixed, 58.0f);
                ImGui::TableHeadersRow();
                const ImVec2 header_min = ImGui::GetItemRectMin();
                const ImVec2 header_max = ImGui::GetItemRectMax();
                ImGui::GetWindowDrawList()->AddLine(ImVec2(header_min.x, header_max.y - 1.0f),
                                                    ImVec2(header_max.x, header_max.y - 1.0f),
                                                    ImGui::GetColorU32(ImVec4(0.145f, 0.161f, 0.176f, 1.0f)),
                                                    1.0f);

                for (const auto& card : cards) {
                    render_remote_row(registry, state, card, edit_session, edit_panel_visible);
                }
                ImGui::EndTable();
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(5);

            ImGui::SetCursorPosX(18.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::Text("%zu remote%s", cards.size(), cards.size() == 1 ? "" : "s");
            ImGui::PopStyleColor();
            ImGui::SameLine(ImGui::GetContentRegionAvail().x - 116.0f);
            if (action_button("Refresh All", "sync-16", ImVec2(116.0f, 34.0f), kCardBg, kCardBgAlt, kMuted)) {
                state.refresh_all();
            }
        }
    }
    ImGui::EndChild();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(4);
}

std::vector<std::string> ordered_config_keys(const ProviderRemoteEditSession& session) {
    const std::vector<std::string> preferred = {
        "root_folder_id",
        "scope",
        "client_id",
        "client_secret",
        "token",
        "drive_id",
        "drive_type",
        "service_account_file",
        "team_drive",
        "access_key_id",
        "secret_access_key",
        "endpoint",
        "region",
        "bucket",
        "root",
    };

    std::vector<std::string> keys;
    std::set<std::string> seen;
    for (const auto& key : preferred) {
        if (session.edit_config.find(key) != session.edit_config.end() && key != "type") {
            keys.push_back(key);
            seen.insert(key);
        }
    }
    for (const auto& [key, value] : session.edit_config) {
        (void)value;
        if (key != "type" && !seen.count(key)) {
            keys.push_back(key);
        }
    }
    return keys;
}

std::string pretty_label(std::string key) {
    for (char& c : key) {
        if (c == '_') {
            c = ' ';
        }
    }
    if (!key.empty()) {
        key[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(key[0])));
    }
    return key;
}

bool text_input_field(const char* id,
                      const std::string& label,
                      const std::string& value,
                      bool password,
                      bool read_only,
                      float width,
                      std::string* changed_value) {
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(label.c_str());
    ImGui::PopStyleColor();
    ImGui::Dummy(ImVec2(0.0f, 2.0f));

    char buffer[16384];
    std::snprintf(buffer, sizeof(buffer), "%s", value.c_str());
    ImGui::SetNextItemWidth(width);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.035f, 0.043f, 0.051f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.055f, 0.063f, 0.071f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.055f, 0.063f, 0.071f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 7.0f));
    ImGuiInputTextFlags flags = read_only ? ImGuiInputTextFlags_ReadOnly : ImGuiInputTextFlags_None;
    if (password) {
        flags |= ImGuiInputTextFlags_Password;
    }
    const bool changed = ImGui::InputText(id, buffer, sizeof(buffer), flags);
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(4);

    if (changed && changed_value) {
        *changed_value = buffer;
    }
    return changed;
}

bool edit_field_group(const char* id,
                      const std::string& label,
                      const std::string& value,
                      bool password,
                      bool read_only,
                      float width,
                      std::string* changed_value) {
    ImGui::BeginGroup();
    const bool changed = text_input_field(id, label, value, password, read_only, width, changed_value);
    ImGui::EndGroup();
    return changed;
}

void render_token_fields(ProvidersState& state,
                         const ProviderRemoteEditSession& session,
                         float form_width) {
    const std::string token_json = config_value(session, "token");
    const auto fields = parse_rclone_token_fields(token_json);
    std::string changed;

    if (fields.empty()) {
        const float token_width = form_width - 50.0f;
        const bool changed_token = edit_field_group(
            "##provider_token_raw", "Token", token_json, !session.token_visible,
            session.saving, token_width, &changed);
        ImGui::SameLine(0.0f, 6.0f);
        if (icon_button("##toggle_provider_token", session.token_visible ? "eye-closed-16" : "eye-16",
                        session.token_visible ? "Hide token" : "Show token",
                        ImVec2(38.0f, 34.0f), kText)) {
            state.toggle_token_visibility();
        }
        if (changed_token) {
            state.set_edit_field("token", changed);
        }
        return;
    }

    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::TextUnformatted("Authentication");
    ImGui::PopStyleColor();
    ImGui::SameLine(form_width - 38.0f);
    if (icon_button("##toggle_provider_token", session.token_visible ? "eye-closed-16" : "eye-16",
                    session.token_visible ? "Hide credentials" : "Show credentials",
                    ImVec2(38.0f, 34.0f), kText)) {
        state.toggle_token_visibility();
    }
    ImGui::Dummy(ImVec2(0.0f, 6.0f));

    for (const auto& field : fields) {
        ImGui::PushID(field.key.c_str());
        if (edit_field_group("##token_field", pretty_label(field.key), field.value,
                             field.sensitive && !session.token_visible,
                             session.saving, form_width, &changed)) {
            state.set_edit_field("token", update_rclone_token_field(token_json, field.key, changed));
        }
        ImGui::PopID();
        ImGui::Dummy(ImVec2(0.0f, 7.0f));
    }
}

void draw_edit_header(ProvidersState& state, const ProviderCard* selected_card, const ProviderRemoteEditSession& session, float width) {
    const float header_start_y = ImGui::GetCursorPosY();
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::SetWindowFontScale(1.1f);
    ImGui::TextUnformatted("Edit Remote");
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopStyleColor();

    ImGui::SetCursorPosY(header_start_y + 28.0f);
    ImGui::Dummy(ImVec2(0.0f, 10.0f));
    if (!selected_card) {
        return;
    }

    draw_provider_logo(*selected_card, 34.0f);
    ImGui::SameLine(0.0f, 12.0f);
    ImGui::BeginGroup();
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::SetWindowFontScale(1.08f);
    ImGui::TextUnformatted(session.selected_remote.empty() ? selected_card->id.c_str() : session.selected_remote.c_str());
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopStyleColor();
    ImGui::SameLine(0.0f, 8.0f);
    draw_status_pill(*selected_card);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::Text("Type: %s  |  Last checked: %s",
                provider_type_label(*selected_card).c_str(),
                last_checked_text(*selected_card, session).c_str());
    ImGui::PopStyleColor();
    ImGui::EndGroup();

    ImGui::SameLine(width - 96.0f);
    if (icon_button("##disconnect_selected", "trash-24", "Disconnect remote", ImVec2(36.0f, 36.0f), kDanger, true)) {
        state.on_request_disconnect(selected_card->id);
    }
    ImGui::SameLine(0.0f, 8.0f);
    if (icon_button("##copy_remote_name", "copy-24", "Copy remote name", ImVec2(36.0f, 36.0f), kText)) {
        ImGui::SetClipboardText(session.selected_remote.c_str());
    }
}

void render_edit_form(ProvidersState& state, const ProviderRemoteEditSession& session, float width) {
    const float field_gap = 12.0f;
    const float form_width = std::max(width, kEditPaneMinContentWidth);
    const bool two_columns = form_width >= 700.0f;
    const float input_width = two_columns ? (form_width - field_gap) * 0.5f : form_width;
    std::string changed;

    if (edit_field_group("##provider_remote_name", "Name", session.selected_remote, false, session.saving, input_width, &changed)) {
        state.set_edit_remote_name(changed);
    }
    if (two_columns) {
        ImGui::SameLine(0.0f, field_gap);
    } else {
        ImGui::Dummy(ImVec2(0.0f, 8.0f));
    }
    edit_field_group("##provider_remote_type", "Type", config_value(session, "type").empty() ? session.provider_type : config_value(session, "type"), false, true, input_width, nullptr);

    ImGui::Dummy(ImVec2(0.0f, 8.0f));

    const std::vector<std::string> keys = ordered_config_keys(session);
    int column = 0;
    for (const auto& key : keys) {
        if (key == "token") {
            render_token_fields(state, session, form_width);
            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            column = 0;
            continue;
        }

        const std::string input_id = "##provider_field_" + key;
        if (edit_field_group(input_id.c_str(), pretty_label(key), config_value(session, key), key.find("secret") != std::string::npos, session.saving, input_width, &changed)) {
            state.set_edit_field(key, changed);
        }
        if (two_columns && column == 0) {
            ImGui::SameLine(0.0f, field_gap);
            column = 1;
        } else {
            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            column = 0;
        }
    }
    ImGui::Dummy(ImVec2(form_width, 1.0f));
}

void render_edit_empty_state(const char* title, const char* detail) {
    ImGui::Dummy(ImVec2(0.0f, 80.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::SetWindowFontScale(1.12f);
    ImGui::TextUnformatted(title);
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopStyleColor();
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextWrapped("%s", detail);
    ImGui::PopStyleColor();
}

void render_message_lines(const ProviderRemoteEditSession& session) {
    if (!session.validation_error.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kWarning);
        ImGui::TextWrapped("%s", session.validation_error.c_str());
        ImGui::PopStyleColor();
    }
    if (!session.error_message.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kDanger);
        ImGui::TextWrapped("%s", session.error_message.c_str());
        ImGui::PopStyleColor();
    }
    if (!session.test_message.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kSuccess);
        ImGui::TextWrapped("%s", session.test_message.c_str());
        ImGui::PopStyleColor();
    }
    if (!session.success_message.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kSuccess);
        ImGui::TextWrapped("%s", session.success_message.c_str());
        ImGui::PopStyleColor();
    }
    if (!session.reveal_error.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kDanger);
        ImGui::TextWrapped("%s", session.reveal_error.c_str());
        ImGui::PopStyleColor();
    }
}

void render_edit_footer(ProvidersState& state, const ProviderRemoteEditSession& session, float width) {
    const float button_h = 40.0f;
    const float gap = 8.0f;
    const float footer_width = std::max(width, kEditPaneMinContentWidth);
    const float test_w = std::max(170.0f, footer_width * 0.29f);
    const float reveal_w = std::max(160.0f, footer_width * 0.28f);
    const float save_w = std::max(170.0f, footer_width - test_w - reveal_w - gap * 2.0f);

    if (session.testing) {
        ImGui::BeginDisabled();
    }
    if (action_button(session.testing ? "Testing..." : "Test Connection",
                      "sync-16",
                      ImVec2(test_w, button_h),
                      ImVec4(0.055f, 0.082f, 0.088f, 1.0f),
                      ImVec4(0.078f, 0.125f, 0.130f, 1.0f),
                      kAccent)) {
        state.test_selected_remote();
    }
    if (session.testing) {
        ImGui::EndDisabled();
    }

    ImGui::SameLine(0.0f, gap);
    if (session.revealing) {
        ImGui::BeginDisabled();
    }
    if (action_button(session.revealing ? "Opening..." : "Reveal Config",
                      "file-directory-open-fill-24",
                      ImVec2(reveal_w, button_h),
                      kCardBgAlt,
                      ImVec4(0.094f, 0.094f, 0.106f, 1.0f),
                      kText)) {
        state.reveal_rclone_config();
    }
    if (session.revealing) {
        ImGui::EndDisabled();
    }

    ImGui::SameLine(0.0f, gap);
    if (!session.can_save) {
        ImGui::BeginDisabled();
    }
    if (action_button(session.saving ? "Saving..." : "Save Changes",
                      "verified-24",
                      ImVec2(save_w, button_h),
                      kBlue,
                      ImVec4(0.196f, 0.498f, 0.945f, 1.0f),
                      ImVec4(0.945f, 0.965f, 1.0f, 1.0f))) {
        state.save_selected_remote();
    }
    if (!session.can_save) {
        ImGui::EndDisabled();
    }
    ImGui::Dummy(ImVec2(footer_width, 1.0f));
}

void render_config_value_row(const char* label, const std::string& value, float width) {
    const float label_width = 150.0f;
    const std::string display = value.empty() ? "--" : value;
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(label);
    ImGui::PopStyleColor();
    ImGui::SameLine(label_width);
    ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + std::max(220.0f, width - label_width - 24.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::TextUnformatted(display.c_str());
    ImGui::PopStyleColor();
    ImGui::PopTextWrapPos();
    if (ImGui::IsItemHovered() && !value.empty()) {
        ImGui::SetTooltip("%s", value.c_str());
    }
    ImGui::Dummy(ImVec2(0.0f, 8.0f));
}

void render_diagnostics_panel(ProvidersState& state, float width, float height) {
    const ProvidersHealthCard health = state.health_card_snapshot();
    const ProviderRcloneConfigSession config = state.rclone_config_session_snapshot();

    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 20.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, kThinScrollbarSize);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

    if (ImGui::BeginChild("##providers_diagnostics_panel", ImVec2(width, height), true, ImGuiWindowFlags_HorizontalScrollbar)) {
        const float visible_width = ImGui::GetContentRegionAvail().x;
        const float content_width = std::max(visible_width, 720.0f);

        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::SetWindowFontScale(1.12f);
        ImGui::TextUnformatted("Diagnostics");
        ImGui::SetWindowFontScale(1.0f);
        ImGui::PopStyleColor();
        ImGui::SameLine(0.0f, 12.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, health.is_ready ? kSuccess : kWarning);
        ImGui::TextUnformatted(health.status_value.c_str());
        ImGui::PopStyleColor();

        ImGui::Dummy(ImVec2(0.0f, 18.0f));
        render_config_value_row("Config path", config.config_path, content_width);
        render_config_value_row("Cache path", config.cache_path, content_width);
        render_config_value_row("Temporary files", config.temp_path, content_width);
        render_config_value_row("RC endpoint", health.port_text, content_width);
        render_config_value_row("Version", health.version_text, content_width);
        render_config_value_row("Remotes", health.remote_count_text, content_width);
        render_config_value_row("Providers", health.provider_count_text, content_width);

        ImGui::Dummy(ImVec2(0.0f, 14.0f));
        ImGui::Separator();
        ImGui::Dummy(ImVec2(0.0f, 14.0f));

        const float button_h = 44.0f;
        const float gap = 14.0f;
        const float refresh_w = 160.0f;
        const float reveal_w = 170.0f;
        const float status_w = 180.0f;

        if (config.loading) {
            ImGui::BeginDisabled();
        }
        if (action_button(config.loading ? "Refreshing..." : "Refresh Paths",
                          "sync-16",
                          ImVec2(refresh_w, button_h),
                          kCardBgAlt,
                          ImVec4(0.094f, 0.094f, 0.106f, 1.0f),
                          kText)) {
            state.refresh_rclone_config_paths();
        }
        if (config.loading) {
            ImGui::EndDisabled();
        }

        ImGui::SameLine(0.0f, gap);
        if (config.revealing) {
            ImGui::BeginDisabled();
        }
        if (action_button(config.revealing ? "Opening..." : "Reveal Config",
                          "file-directory-open-fill-24",
                          ImVec2(reveal_w, button_h),
                          ImVec4(0.055f, 0.082f, 0.088f, 1.0f),
                          ImVec4(0.078f, 0.125f, 0.130f, 1.0f),
                          kAccent)) {
            state.open_rclone_config_file();
        }
        if (config.revealing) {
            ImGui::EndDisabled();
        }

        ImGui::SameLine(0.0f, gap);
        if (action_button("Refresh Service",
                          "sync-16",
                          ImVec2(status_w, button_h),
                          kCardBgAlt,
                          ImVec4(0.094f, 0.094f, 0.106f, 1.0f),
                          kText)) {
            state.refresh_health();
            state.refresh_remote_statuses();
        }

        ImGui::Dummy(ImVec2(0.0f, 14.0f));
        if (!config.error_message.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, kDanger);
            ImGui::TextWrapped("%s", config.error_message.c_str());
            ImGui::PopStyleColor();
        }
        if (!config.success_message.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, kSuccess);
            ImGui::TextWrapped("%s", config.success_message.c_str());
            ImGui::PopStyleColor();
        }
        if (config.loading) {
            ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
            ImGui::TextUnformatted("Loading rclone paths...");
            ImGui::PopStyleColor();
        }
        ImGui::Dummy(ImVec2(content_width, 1.0f));
    }
    ImGui::EndChild();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(4);
}

void render_edit_panel(ProvidersState& state,
                       const std::vector<ProviderCard>& cards,
                       const ProviderRemoteEditSession& session,
                       float width,
                       float height) {
    const ProviderCard* selected_card = nullptr;
    for (const auto& card : cards) {
        if (session.has_selection &&
            (card.id == session.original_remote_name || card.id == session.selected_remote)) {
            selected_card = &card;
            break;
        }
    }

    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(18.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, kThinScrollbarSize);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

    ImGui::SetNextWindowContentSize(ImVec2(kEditPaneMinContentWidth, 0.0f));
    if (ImGui::BeginChild("##providers_edit_panel", ImVec2(width, height), true,
                          ImGuiWindowFlags_HorizontalScrollbar)) {
        const float visible_width = ImGui::GetContentRegionAvail().x;
        const float header_width = std::max(visible_width, kEditPaneMinContentWidth);
        const float form_width = std::min(header_width, kEditPaneMaxFormWidth);
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 10.0f);
        draw_edit_header(state, selected_card, session, header_width);
        ImGui::Dummy(ImVec2(0.0f, 8.0f));
        ImGui::Separator();
        ImGui::Dummy(ImVec2(0.0f, 10.0f));

        if (!session.has_selection) {
            render_edit_empty_state("Select a remote", "Choose a remote from the table to view and edit its rclone configuration.");
        } else if (session.loading) {
            render_edit_empty_state("Loading remote...", "Fetching rclone configuration and storage details.");
        } else {
            render_edit_form(state, session, form_width);
            render_message_lines(session);
        }

        ImGui::Separator();
        ImGui::Dummy(ImVec2(0.0f, 10.0f));
        if (session.has_selection && !session.loading) {
            render_edit_footer(state, session, form_width);
        }
        ImGui::Dummy(ImVec2(form_width, 1.0f));
    }
    ImGui::EndChild();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(4);
}

}  // namespace

void render_providers_workspace(core::StateRegistry& registry,
                                ProvidersState& state,
                                float max_height) {
    const auto cards = state.filtered_provider_cards();
    const ProvidersPageTab selected_tab = state.selected_page_tab();
    const float available_width = ImGui::GetContentRegionAvail().x;
    ProviderRemoteEditSession edit_session = state.remote_edit_session_snapshot();
    if (selected_tab == ProvidersPageTab::Remotes && !edit_session.has_selection && !cards.empty()) {
        state.select_remote(cards.front().id);
        edit_session = state.remote_edit_session_snapshot();
    }

    ImGui::PushStyleColor(ImGuiCol_WindowBg, kPageBg);

    render_page_toolbar(state, selected_tab, available_width);
    ImGui::Dummy(ImVec2(0.0f, 8.0f));

    const float height = std::max(260.0f, max_height - 58.0f);
    const float gap = 12.0f;
    if (selected_tab == ProvidersPageTab::Diagnostics) {
        render_diagnostics_panel(state, available_width, height);
    } else {
        const float usable_width = std::max(0.0f, available_width - gap);
        const float left_width = usable_width * 0.46f;
        const float right_width = usable_width - left_width;
        render_remote_table(registry, state, cards, edit_session, true, left_width, height);
        ImGui::SameLine(0.0f, gap);
        render_edit_panel(state, cards, edit_session, right_width, height);
    }
    ImGui::PopStyleColor();
}

}  // namespace misty::panel
