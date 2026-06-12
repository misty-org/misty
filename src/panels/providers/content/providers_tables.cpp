#include "panels/providers/content/providers_tables.h"

#include <cstdio>
#include <string>

#include "core/manager/asset_manager.h"
#include "imgui.h"
#include "panels/providers/cards/provider_cards_util.h"
#include "panels/providers/content/providers_table_util.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kCardBg(0.16f, 0.18f, 0.20f, 1.0f);
constexpr ImVec4 kHeaderBg(0.11f, 0.13f, 0.15f, 1.0f);
constexpr ImVec4 kBorder(0.24f, 0.27f, 0.30f, 1.0f);
constexpr ImVec4 kText(0.945f, 0.933f, 0.910f, 1.0f);
constexpr ImVec4 kMuted(0.788f, 0.769f, 0.737f, 1.0f);
constexpr ImVec4 kAccent(0.48f, 0.86f, 0.59f, 1.0f);
constexpr ImVec4 kWarning(0.96f, 0.68f, 0.28f, 1.0f);
constexpr float kThinScrollbarSize = 8.0f;
constexpr float kConnectedAccountRowHeight = 74.0f;
constexpr float kConnectedAccountLogoSize = 34.0f;
constexpr float kConnectedAccountButtonHeight = 34.0f;

ImVec2 aligned_cell_cursor(float row_height, float content_height) {
    const ImVec2 cursor = ImGui::GetCursorPos();
    const float cell_content_height =
        std::max(0.0f, row_height - ImGui::GetStyle().CellPadding.y * 2.0f);
    return ImVec2(cursor.x,
                  cursor.y + std::max(0.0f, (cell_content_height - content_height) * 0.5f));
}

void draw_section_header(const char* label, size_t count) {
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::SetWindowFontScale(1.08f);
    ImGui::TextUnformatted(label);
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopStyleColor();

    ImGui::SameLine(0.0f, 10.0f);
    char count_text[32];
    std::snprintf(count_text, sizeof(count_text), "%zu", count);
    const ImVec2 text_size = ImGui::CalcTextSize(count_text);
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 size(text_size.x + 14.0f, 22.0f);
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddCircleFilled(ImVec2(pos.x + size.x * 0.5f, pos.y + size.y * 0.5f),
                               size.y * 0.5f,
                               ImGui::GetColorU32(ImVec4(0.17f, 0.19f, 0.22f, 1.0f)));
    draw_list->AddCircle(ImVec2(pos.x + size.x * 0.5f, pos.y + size.y * 0.5f),
                         size.y * 0.5f,
                         ImGui::GetColorU32(kBorder));
    ImGui::SetCursorScreenPos(ImVec2(pos.x + (size.x - text_size.x) * 0.5f,
                                     pos.y + (size.y - text_size.y) * 0.5f));
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(count_text);
    ImGui::PopStyleColor();
    ImGui::SetCursorScreenPos(pos);
    ImGui::Dummy(size);
}

bool provider_action_button(const char* label, const char* icon_name, const ImVec2& size, bool danger = false) {
    const ImVec4 bg = danger ? ImVec4(0.17f, 0.15f, 0.15f, 1.0f) : ImVec4(0.15f, 0.17f, 0.19f, 1.0f);
    const ImVec4 hovered = danger ? ImVec4(0.26f, 0.17f, 0.17f, 1.0f) : ImVec4(0.20f, 0.22f, 0.25f, 1.0f);
    const ImVec4 active = danger ? ImVec4(0.18f, 0.11f, 0.11f, 1.0f) : ImVec4(0.12f, 0.14f, 0.16f, 1.0f);
    const ImVec4 border = danger ? ImVec4(0.45f, 0.19f, 0.17f, 1.0f) : kBorder;
    const ImVec4 text = danger ? ImVec4(0.97f, 0.39f, 0.34f, 1.0f) : kText;
    ImGui::PushStyleColor(ImGuiCol_Button, bg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, hovered);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, active);
    ImGui::PushStyleColor(ImGuiCol_Border, border);
    ImGui::PushStyleColor(ImGuiCol_Text, text);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const bool pressed = ImGui::Button(("##" + std::string(label)).c_str(), size);
    auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 18);
    const float icon_size = 16.0f;
    const float gap = 8.0f;
    const ImVec2 text_size = ImGui::CalcTextSize(label);
    const float total_width = (icon.id != 0 ? icon_size + gap : 0.0f) + text_size.x;
    const float x = pos.x + (size.x - total_width) * 0.5f;
    const float y = pos.y + (size.y - icon_size) * 0.5f;
    if (icon.id != 0) {
        ImGui::GetWindowDrawList()->AddImage(
            icon.id,
            ImVec2(x, y),
            ImVec2(x + icon_size, y + icon_size),
            ImVec2(0.0f, 0.0f),
            ImVec2(1.0f, 1.0f),
            ImGui::GetColorU32(text));
    }
    ImGui::GetWindowDrawList()->AddText(
        ImVec2(x + (icon.id != 0 ? icon_size + gap : 0.0f), pos.y + (size.y - text_size.y) * 0.5f),
        ImGui::GetColorU32(text),
        label);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(5);
    return pressed;
}

bool provider_icon_button(const char* id, const char* icon_name, const char* tooltip, const ImVec2& size) {
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const bool pressed = ImGui::InvisibleButton(id, size);
    const bool hovered = ImGui::IsItemHovered();
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const ImVec4 bg = hovered ? ImVec4(0.20f, 0.22f, 0.25f, 1.0f) : ImVec4(0.15f, 0.17f, 0.19f, 1.0f);
    draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(bg), 8.0f);
    draw_list->AddRect(pos, ImVec2(pos.x + size.x, pos.y + size.y), ImGui::GetColorU32(kBorder), 8.0f);
    auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 24);
    if (icon.id != 0) {
        const float icon_size = 18.0f;
        const ImVec2 icon_pos(pos.x + (size.x - icon_size) * 0.5f, pos.y + (size.y - icon_size) * 0.5f);
        draw_list->AddImage(icon.id, icon_pos, ImVec2(icon_pos.x + icon_size, icon_pos.y + icon_size));
    }
    if (hovered && tooltip != nullptr) {
        ImGui::SetTooltip("%s", tooltip);
    }
    return pressed;
}

void render_status_dot_label(const char* text, const ImVec4& dot_color, const ImVec4& text_color) {
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    ImGui::GetWindowDrawList()->AddCircleFilled(
        ImVec2(cursor.x + 4.0f, cursor.y + ImGui::GetTextLineHeight() * 0.5f),
        3.0f,
        ImGui::GetColorU32(dot_color));
    ImGui::SetCursorScreenPos(ImVec2(cursor.x + 16.0f, cursor.y));
    ImGui::PushStyleColor(ImGuiCol_Text, text_color);
    ImGui::TextUnformatted(text);
    ImGui::PopStyleColor();
}

void render_provider_status_cell(const ProviderCard& card) {
    render_status_dot_label(providers_content::provider_status_text(card),
                            card.needs_reconnect ? kWarning : kAccent,
                            card.needs_reconnect ? kWarning : kText);
}

void render_connected_account_row(ProvidersState& state, const ProviderCard& card) {
    ImGui::TableNextRow(ImGuiTableRowFlags_None, kConnectedAccountRowHeight);

    ImGui::TableSetColumnIndex(0);
    const std::string secondary_label = providers_content::provider_secondary_label(card);
    const ImVec2 provider_label_size = ImGui::CalcTextSize(card.provider_label.c_str());
    const ImVec2 secondary_label_size = ImGui::CalcTextSize(secondary_label.c_str());
    const float provider_text_height = provider_label_size.y + secondary_label_size.y + ImGui::GetStyle().ItemSpacing.y;
    const float provider_block_height = std::max(kConnectedAccountLogoSize, provider_text_height);
    const ImVec2 provider_origin =
        aligned_cell_cursor(kConnectedAccountRowHeight, provider_block_height);
    const float provider_label_y =
        provider_origin.y + std::max(0.0f, (provider_block_height - provider_text_height) * 0.5f);
    const float secondary_label_y =
        provider_label_y + provider_label_size.y + ImGui::GetStyle().ItemSpacing.y;
    const float provider_text_x = provider_origin.x + kConnectedAccountLogoSize + 12.0f;
    ImGui::SetCursorPos(ImVec2(provider_origin.x,
                               provider_origin.y + std::max(0.0f, (provider_block_height - kConnectedAccountLogoSize) * 0.5f)));
    draw_provider_logo(card, kConnectedAccountLogoSize);
    ImGui::SetCursorPos(ImVec2(provider_text_x, provider_label_y));
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::SetWindowFontScale(1.02f);
    ImGui::TextUnformatted(card.provider_label.c_str());
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopStyleColor();
    ImGui::SetCursorPos(ImVec2(provider_text_x, secondary_label_y));
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(secondary_label.c_str());
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(1);
    ImGui::SetCursorPos(aligned_cell_cursor(kConnectedAccountRowHeight, ImGui::GetTextLineHeight()));
    render_provider_status_cell(card);

    ImGui::TableSetColumnIndex(2);
    ImGui::PushID(card.id.c_str());
    const char* primary_label = card.needs_reconnect ? "Reconnect" : (card.unavailable ? "Configure" : "Rename");
    const char* primary_icon = card.needs_reconnect ? "sync-16" : (card.unavailable ? "settings-sync-16" : "pencil-16");
    const float primary_button_width = 108.0f;
    const float disconnect_button_width = 118.0f;
    const float menu_button_width = 48.0f;
    const float button_gap = 12.0f;
    ImGui::SetCursorPos(aligned_cell_cursor(kConnectedAccountRowHeight, kConnectedAccountButtonHeight));
    if (provider_action_button(primary_label, primary_icon, ImVec2(primary_button_width, kConnectedAccountButtonHeight))) {
        if (card.needs_reconnect) {
            state.on_request_reconnect(card.id);
        } else if (card.unavailable) {
            state.on_request_repair(card.id);
        } else {
            state.on_request_rename(card.id);
        }
    }
    ImGui::SameLine(0.0f, button_gap);
    if (provider_action_button("Disconnect", "unlink-16", ImVec2(disconnect_button_width, kConnectedAccountButtonHeight), true)) {
        state.on_request_disconnect(card.id);
    }
    ImGui::SameLine(0.0f, button_gap);
    provider_icon_button("##more", "kebab-horizontal-24", "More actions", ImVec2(menu_button_width, kConnectedAccountButtonHeight));
    ImGui::PopID();
}

void render_provider_empty_state(bool filtered, bool loading) {
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 14.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);

    if (ImGui::BeginChild("##providers_empty_state", ImVec2(0.0f, 180.0f), true,
                          ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::SetWindowFontScale(1.1f);
        if (loading) {
            ImGui::TextUnformatted("Loading providers...");
        } else {
            ImGui::TextUnformatted(filtered ? "No matching providers" : "No providers connected yet");
        }
        ImGui::SetWindowFontScale(1.0f);
        ImGui::PopStyleColor();

        ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
        if (loading) {
            ImGui::TextWrapped("Misty is trying to fetch connected providers and available provider workflows.");
        } else if (filtered) {
            ImGui::TextWrapped("Try a different search term or clear the filter to see all connected providers.");
        } else {
            ImGui::TextWrapped("No providers are connected yet. Use Add Provider to start an rclone-backed setup flow.");
        }
        ImGui::PopStyleColor();
    }

    ImGui::EndChild();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(2);
}

}  // namespace

void render_connected_accounts_table(ProvidersState& state,
                                     float max_list_height) {
    const auto all_cards = state.provider_cards_snapshot();
    const auto filtered_cards = state.filtered_provider_cards();
    const bool has_query = !state.search_query().empty();
    bool loading = false;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        loading = state.is_loading_workflows || state.is_loading_remotes || state.is_loading_remote_statuses;
    }

    ImGui::Dummy(ImVec2(0.0f, 6.0f));
    draw_section_header("Connected Accounts", filtered_cards.size());

    if (filtered_cards.empty()) {
        render_provider_empty_state(has_query && !all_cards.empty(), loading && all_cards.empty());
        return;
    }

    ImGui::Dummy(ImVec2(0.0f, 10.0f));
    const float content_height = 44.0f + kConnectedAccountRowHeight * static_cast<float>(filtered_cards.size());
    const float available_height = std::max(48.0f, max_list_height);
    const float height = std::max(48.0f, std::min(content_height, available_height));
    const ImGuiTableFlags flags =
        ImGuiTableFlags_BordersInnerH |
        ImGuiTableFlags_BordersOuter |
        ImGuiTableFlags_ScrollY |
        ImGuiTableFlags_SizingStretchProp;

    ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_CellPadding, ImVec2(12.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, kThinScrollbarSize);
    if (ImGui::BeginTable("##providers_connected_accounts_table", 3, flags, ImVec2(0.0f, height))) {
        ImGui::TableSetupColumn("Provider", ImGuiTableColumnFlags_WidthStretch, 0.42f);
        ImGui::TableSetupColumn("Status", ImGuiTableColumnFlags_WidthFixed, 190.0f);
        ImGui::TableSetupColumn("Actions", ImGuiTableColumnFlags_WidthFixed, 340.0f);

        for (const auto& card : filtered_cards) {
            render_connected_account_row(state, card);
        }

        ImGui::EndTable();
    }
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(2);
}

}  // namespace misty::panel
