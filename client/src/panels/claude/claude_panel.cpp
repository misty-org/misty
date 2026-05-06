#include "panels/claude/claude_panel.h"

#include <algorithm>
#include <cctype>
#include <cfloat>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>

#include <nlohmann/json.hpp>

#include "core/manager/asset_manager.h"
#include "core/manager/font_manager.h"

namespace misty::panel {

namespace {

using misty::core::AssetManager;
namespace fs = std::filesystem;
using json = nlohmann::json;

fs::path claude_profiles_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') {
        return {};
    }
    return fs::path(home) / "misty" / "config" / "claude_profiles.json";
}

std::string trim(const std::string& s) {
    auto start = std::find_if_not(s.begin(), s.end(),
                                  [](unsigned char c) { return std::isspace(c); });
    auto end = std::find_if_not(s.rbegin(), s.rend(),
                                [](unsigned char c) { return std::isspace(c); }).base();
    return (start < end) ? std::string(start, end) : std::string();
}

// ── Lightweight markdown block parser ──────────────────────────────────────
//
// Splits markdown source into blocks that can be rendered with distinct ImGui
// styles. Inline markdown is preserved for paragraph/list rendering.

enum class BlockType { PARAGRAPH, HEADING, CODE_BLOCK, BULLET };

struct MdBlock {
    BlockType type;
    int heading_level;     // 1-3 for HEADING
    std::string text;      // raw block content
    std::string lang;      // language hint for CODE_BLOCK
};

/// Strip inline markdown markers from a single line.
/// Used only for heading fallback, where we keep larger heading styling but
/// don't attempt full nested inline formatting inside the heading text.
std::string strip_inline(const std::string& line) {
    std::string out;
    out.reserve(line.size());
    for (size_t i = 0; i < line.size(); ) {
        if (i + 1 < line.size() && line[i] == '*' && line[i + 1] == '*') {
            i += 2; continue;
        }
        if (i + 1 < line.size() && line[i] == '_' && line[i + 1] == '_') {
            i += 2; continue;
        }
        if (line[i] == '*' && i + 1 < line.size() && line[i + 1] != ' ') {
            ++i; continue;
        }
        if (line[i] == '`') { ++i; continue; }
        out += line[i];
        ++i;
    }
    return out;
}

std::vector<MdBlock> parse_markdown(const std::string& src) {
    std::vector<MdBlock> blocks;
    std::istringstream stream(src);
    std::string line;
    bool in_code = false;
    std::string code_buf;
    std::string code_lang;

    while (std::getline(stream, line)) {
        // Fenced code blocks
        if (line.size() >= 3 && line.substr(0, 3) == "```") {
            if (!in_code) {
                in_code = true;
                code_lang = (line.size() > 3) ? line.substr(3) : "";
                code_buf.clear();
            } else {
                // Close code block
                if (!code_buf.empty() && code_buf.back() == '\n')
                    code_buf.pop_back();
                blocks.push_back({BlockType::CODE_BLOCK, 0, code_buf, code_lang});
                in_code = false;
            }
            continue;
        }
        if (in_code) {
            code_buf += line + "\n";
            continue;
        }

        // Heading
        {
            size_t lvl = 0;
            while (lvl < line.size() && line[lvl] == '#') ++lvl;
            if (lvl > 0 && lvl <= 3 && lvl < line.size() && line[lvl] == ' ') {
                std::string heading_text = line.substr(lvl + 1);
                blocks.push_back({BlockType::HEADING, static_cast<int>(lvl), heading_text, {}});
                continue;
            }
        }

        // Bullet list
        if (line.size() >= 2 && (line[0] == '-' || line[0] == '*') && line[1] == ' ') {
            std::string bullet_text = line.substr(2);
            blocks.push_back({BlockType::BULLET, 0, bullet_text, {}});
            continue;
        }
        // Numbered list (e.g. "1. text")
        {
            size_t i = 0;
            while (i < line.size() && std::isdigit(static_cast<unsigned char>(line[i]))) ++i;
            if (i > 0 && i + 1 < line.size() && line[i] == '.' && line[i + 1] == ' ') {
                std::string item_text = line.substr(0, i) + ". " + line.substr(i + 2);
                blocks.push_back({BlockType::BULLET, 0, item_text, {}});
                continue;
            }
        }

        // Empty line — skip (acts as paragraph separator)
        if (trim(line).empty()) continue;

        // Regular paragraph — merge consecutive lines
        std::string para = line;
        if (!blocks.empty() && blocks.back().type == BlockType::PARAGRAPH) {
            blocks.back().text += " " + para;
        } else {
            blocks.push_back({BlockType::PARAGRAPH, 0, para, {}});
        }
    }

    // Handle unclosed code block
    if (in_code && !code_buf.empty()) {
        if (code_buf.back() == '\n') code_buf.pop_back();
        blocks.push_back({BlockType::CODE_BLOCK, 0, code_buf, code_lang});
    }

    return blocks;
}

// ── Inline span parser ─────────────────────────────────────────────────────
//
// Splits a line into runs of normal, bold, italic, bold-italic, and code text
// so we can push the right font for each run.

enum class SpanStyle { NORMAL, BOLD, ITALIC, BOLD_ITALIC, CODE };

struct InlineSpan {
    SpanStyle style;
    std::string text;
};

std::vector<InlineSpan> parse_inline_spans(const std::string& line) {
    std::vector<InlineSpan> spans;
    size_t i = 0;
    std::string buf;
    SpanStyle cur = SpanStyle::NORMAL;

    auto flush = [&]() {
        if (!buf.empty()) {
            spans.push_back({cur, buf});
            buf.clear();
        }
    };

    while (i < line.size()) {
        // Inline code: `...`
        if (line[i] == '`') {
            flush();
            ++i;
            std::string code;
            while (i < line.size() && line[i] != '`') {
                code += line[i]; ++i;
            }
            if (i < line.size()) ++i; // skip closing `
            spans.push_back({SpanStyle::CODE, code});
            continue;
        }
        // Bold-italic: ***...*** or ___...___
        if (i + 2 < line.size() && line[i] == '*' && line[i+1] == '*' && line[i+2] == '*') {
            flush();
            cur = (cur == SpanStyle::BOLD_ITALIC) ? SpanStyle::NORMAL : SpanStyle::BOLD_ITALIC;
            i += 3;
            continue;
        }
        // Bold: **...** or __...__
        if (i + 1 < line.size() && line[i] == '*' && line[i+1] == '*') {
            flush();
            cur = (cur == SpanStyle::BOLD) ? SpanStyle::NORMAL : SpanStyle::BOLD;
            i += 2;
            continue;
        }
        if (i + 1 < line.size() && line[i] == '_' && line[i+1] == '_') {
            flush();
            cur = (cur == SpanStyle::BOLD) ? SpanStyle::NORMAL : SpanStyle::BOLD;
            i += 2;
            continue;
        }
        // Italic: *...* (only if not a lone * surrounded by spaces)
        if (line[i] == '*' && i + 1 < line.size() && line[i+1] != ' ') {
            flush();
            cur = (cur == SpanStyle::ITALIC) ? SpanStyle::NORMAL : SpanStyle::ITALIC;
            ++i;
            continue;
        }
        buf += line[i];
        ++i;
    }
    flush();
    return spans;
}

/// Render a single line with inline font switching for bold/italic/code spans.
/// Falls back to TextWrapped for lines with no formatting.
void render_inline_formatted(const std::string& line) {
    auto spans = parse_inline_spans(line);

    // Fast path: single normal span — just use TextWrapped
    if (spans.size() == 1 && spans[0].style == SpanStyle::NORMAL) {
        ImGui::TextWrapped("%s", spans[0].text.c_str());
        return;
    }

    ImFont* font_regular     = core::FontManager::get().get_font(core::FontID::DEFAULT);
    ImFont* font_bold        = core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD);
    ImFont* font_italic      = core::FontManager::get().get_font(core::FontID::ROBOTO_ITALIC);
    ImFont* font_bold_italic = core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD_ITALIC);

    float wrap_width = ImGui::GetContentRegionAvail().x;
    float cursor_x = ImGui::GetCursorPosX();
    float start_x = cursor_x;

    for (const auto& span : spans) {
        if (span.text.empty()) continue;

        ImFont* font = font_regular;
        ImVec4 color = ImVec4(0.93f, 0.93f, 0.93f, 1.0f);

        switch (span.style) {
            case SpanStyle::BOLD:
                font = font_bold;
                color = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
                break;
            case SpanStyle::ITALIC:
                font = font_italic;
                break;
            case SpanStyle::BOLD_ITALIC:
                font = font_bold_italic;
                color = ImVec4(1.0f, 1.0f, 1.0f, 1.0f);
                break;
            case SpanStyle::CODE:
                color = ImVec4(0.78f, 0.85f, 0.70f, 1.0f);
                break;
            case SpanStyle::NORMAL:
                break;
        }

        ImGui::PushFont(font);
        ImGui::PushStyleColor(ImGuiCol_Text, color);

        // Word-wrap manually by checking each word fits
        const char* text = span.text.c_str();
        const char* end = text + span.text.size();
        const char* word_start = text;

        while (word_start < end) {
            // Find end of current word (include trailing space)
            const char* word_end = word_start;
            while (word_end < end && *word_end != ' ') ++word_end;
            if (word_end < end) ++word_end; // include space

            std::string word(word_start, word_end);
            ImVec2 word_size = ImGui::CalcTextSize(word.c_str());

            if (cursor_x + word_size.x > start_x + wrap_width &&
                cursor_x > start_x) {
                // Wrap to next line
                ImGui::NewLine();
                cursor_x = start_x;
            }

            if (cursor_x > start_x) {
                ImGui::SameLine(0, 0);
            }
            ImGui::TextUnformatted(word.c_str(), word.c_str() + word.size());
            cursor_x += word_size.x;
            word_start = word_end;
        }

        ImGui::PopStyleColor();
        ImGui::PopFont();
    }
}

// ── Render parsed markdown blocks into ImGui ───────────────────────────────

void render_markdown(const std::vector<MdBlock>& blocks) {
    auto& am = AssetManager::get();

    for (size_t i = 0; i < blocks.size(); ++i) {
        const auto& b = blocks[i];
        ImGui::PushID(static_cast<int>(i));

        switch (b.type) {
            case BlockType::HEADING: {
                ImFont* heading_font = (b.heading_level == 1)
                    ? core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD_LARGE)
                    : core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD);
                float scale = (b.heading_level == 1) ? 1.0f :
                              (b.heading_level == 2) ? 1.0f : 0.95f;
                ImGui::PushFont(heading_font);
                if (b.heading_level >= 3) ImGui::SetWindowFontScale(scale);
                ImGui::PushStyleColor(ImGuiCol_Text,
                                      ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
                const std::string heading_text = strip_inline(b.text);
                ImGui::TextWrapped("%s", heading_text.c_str());
                ImGui::PopStyleColor();
                if (b.heading_level >= 3) ImGui::SetWindowFontScale(1.0f);
                ImGui::PopFont();
                ImGui::Spacing();
                break;
            }

            case BlockType::CODE_BLOCK: {
                int line_count = 1;
                line_count += static_cast<int>(std::count(b.text.begin(), b.text.end(), '\n'));
                float h = std::max(36.0f, line_count * ImGui::GetTextLineHeightWithSpacing() + 16.0f);

                ImGui::PushStyleColor(ImGuiCol_ChildBg,
                                      IM_COL32(30, 30, 30, 255));
                ImGui::PushStyleColor(ImGuiCol_Border,
                                      IM_COL32(60, 60, 60, 255));
                ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 4.0f);
                ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,
                                    ImVec2(8.0f, 6.0f));
                if (ImGui::BeginChild("##code", ImVec2(0, h), true,
                                      ImGuiWindowFlags_HorizontalScrollbar)) {
                    ImGui::PushStyleColor(ImGuiCol_Text,
                                          ImVec4(0.78f, 0.85f, 0.70f, 1.0f));
                    ImGui::TextUnformatted(b.text.c_str());
                    ImGui::PopStyleColor();
                }
                ImGui::EndChild();
                ImGui::PopStyleVar(2);
                ImGui::PopStyleColor(2);
                ImGui::Spacing();
                break;
            }

            case BlockType::BULLET: {
                float indent = 16.0f;
                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + indent);

                ImVec2 pos = ImGui::GetCursorScreenPos();
                float font_size = ImGui::GetFontSize();
                ImGui::GetWindowDrawList()->AddCircleFilled(
                    ImVec2(pos.x - 8.0f, pos.y + font_size * 0.45f),
                    2.5f,
                    IM_COL32(170, 170, 170, 255));

                render_inline_formatted(b.text);
                break;
            }

            case BlockType::PARAGRAPH: {
                render_inline_formatted(b.text);
                ImGui::Spacing();
                break;
            }
        }

        ImGui::PopID();
    }
}

// ── Copy button overlay (shown on hover) ───────────────────────────────────

bool render_copy_button(const std::string& content) {
    const ImVec2 group_min = ImGui::GetItemRectMin();
    const ImVec2 group_max = ImGui::GetItemRectMax();
    const bool hovered = ImGui::IsMouseHoveringRect(group_min, group_max, true);
    bool copy_btn_hovered = false;

    if (hovered && !content.empty()) {
        auto& copy_icon = AssetManager::get().get_svg_texture("copy-16", 16);
        const ImVec2 saved_cursor = ImGui::GetCursorScreenPos();
        const ImVec2 button_size(20.0f, 20.0f);
        const ImVec2 button_pos(group_max.x - button_size.x - 6.0f,
                                group_min.y - 2.0f);
        ImGui::SetCursorScreenPos(button_pos);

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered,
                              ImVec4(0.24f, 0.24f, 0.24f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive,
                              ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        bool clicked = false;
        if (copy_icon.id != 0) {
            clicked = ImGui::ImageButton("##copy", copy_icon.id,
                                         ImVec2(16.0f, 16.0f),
                                         ImVec2(0, 0), ImVec2(1, 1),
                                         ImVec4(0, 0, 0, 0),
                                         ImVec4(0.82f, 0.82f, 0.82f, 1.0f));
        } else {
            clicked = ImGui::SmallButton("C");
        }
        copy_btn_hovered = ImGui::IsItemHovered();
        ImGui::PopStyleColor(3);

        if (clicked) {
            ImGui::SetClipboardText(content.c_str());
        }
        ImGui::SetCursorScreenPos(saved_cursor);
    }

    if (copy_btn_hovered) {
        ImGui::SetTooltip("Copy");
    }
    return copy_btn_hovered;
}

} // namespace

// ── Construction ───────────────────────────────────────────────────────────

void ClaudePanel::clear_profile_editor(ClaudeState& state) {
    state.editing_profile_index = -1;
    state.profile_name_buffer[0] = '\0';
    state.profile_api_key_buffer[0] = '\0';
    state.profile_auth_token_buffer[0] = '\0';
    state.profile_base_url_buffer[0] = '\0';
}

void ClaudePanel::load_profile_into_editor(ClaudeState& state, int profile_index) {
    if (profile_index < 0 || profile_index >= static_cast<int>(state.auth_profiles.size())) {
        clear_profile_editor(state);
        return;
    }
    state.editing_profile_index = profile_index;
    const ClaudeAuthProfile& profile = state.auth_profiles[static_cast<size_t>(profile_index)];
    std::snprintf(state.profile_name_buffer, sizeof(state.profile_name_buffer), "%s", profile.name.c_str());
    std::snprintf(state.profile_api_key_buffer, sizeof(state.profile_api_key_buffer), "%s", profile.api_key.c_str());
    std::snprintf(state.profile_auth_token_buffer, sizeof(state.profile_auth_token_buffer), "%s", profile.auth_token.c_str());
    std::snprintf(state.profile_base_url_buffer, sizeof(state.profile_base_url_buffer), "%s", profile.base_url.c_str());
}

void ClaudePanel::ensure_profiles_loaded(ClaudeState& state) {
    if (state.profiles_loaded) {
        return;
    }

    const fs::path path = claude_profiles_path();
    if (!path.empty() && fs::exists(path)) {
        try {
            std::ifstream input(path);
            json data = json::parse(input);
            state.selected_profile_index = data.value("selected_profile_index", -1);
            if (data.contains("profiles") && data["profiles"].is_array()) {
                for (const auto& item : data["profiles"]) {
                    ClaudeAuthProfile profile;
                    profile.name = item.value("name", "");
                    profile.api_key = item.value("api_key", "");
                    profile.auth_token = item.value("auth_token", "");
                    profile.base_url = item.value("base_url", "");
                    if (!trim(profile.name).empty()) {
                        state.auth_profiles.push_back(std::move(profile));
                    }
                }
            }
        } catch (const std::exception& ex) {
            state.profiles_error_msg = ex.what();
        }
    }

    if (state.selected_profile_index >= static_cast<int>(state.auth_profiles.size())) {
        state.selected_profile_index = -1;
    }
    state.profiles_loaded = true;
}

bool ClaudePanel::save_profiles(const ClaudeState& state, std::string* error) const {
    const fs::path path = claude_profiles_path();
    if (path.empty()) {
        if (error) *error = "Unable to resolve ~/misty/config/claude_profiles.json.";
        return false;
    }

    try {
        fs::create_directories(path.parent_path());
        json data;
        data["selected_profile_index"] = state.selected_profile_index;
        data["profiles"] = json::array();
        for (const auto& profile : state.auth_profiles) {
            data["profiles"].push_back({
                {"name", profile.name},
                {"api_key", profile.api_key},
                {"auth_token", profile.auth_token},
                {"base_url", profile.base_url},
            });
        }

        std::ofstream output(path);
        if (!output.is_open()) {
            if (error) *error = "Failed to open ~/misty/config/claude_profiles.json for writing.";
            return false;
        }
        output << data.dump(2);
        return true;
    } catch (const std::exception& ex) {
        if (error) *error = ex.what();
        return false;
    }
}

void ClaudePanel::apply_profile_selection(ClaudeState& state, int new_index) {
    if (new_index == state.selected_profile_index) {
        return;
    }
    new_session(state);
    state.selected_profile_index = new_index;
    std::string error;
    if (!save_profiles(state, &error)) {
        state.profiles_error_msg = error;
    } else {
        state.profiles_error_msg.clear();
    }
}

void ClaudePanel::render_profiles_modal(ClaudeState& state) {
    if (state.show_profiles_modal) {
        ImGui::OpenPopup("Claude Profiles");
        state.show_profiles_modal = false;
    }

    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    if (!ImGui::BeginPopupModal("Claude Profiles", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        return;
    }

    ImGui::TextUnformatted("Claude auth profiles");
    ImGui::TextDisabled("Profiles are stored in ~/misty/config/claude_profiles.json and applied when Misty spawns the claude CLI.");
    ImGui::Spacing();

    if (ImGui::BeginChild("##claude_profile_list", ImVec2(420.0f, 140.0f), true)) {
        for (int i = 0; i < static_cast<int>(state.auth_profiles.size()); ++i) {
            const bool selected = (state.editing_profile_index == i);
            std::string label = state.auth_profiles[static_cast<size_t>(i)].name;
            if (state.selected_profile_index == i) {
                label += "  [active]";
            }
            if (ImGui::Selectable(label.c_str(), selected)) {
                load_profile_into_editor(state, i);
                state.profiles_error_msg.clear();
            }
        }
    }
    ImGui::EndChild();

    if (ImGui::Button("New", ImVec2(90.0f, 0.0f))) {
        clear_profile_editor(state);
        state.profiles_error_msg.clear();
    }
    ImGui::SameLine();
    ImGui::BeginDisabled(state.editing_profile_index < 0);
    if (ImGui::Button("Delete", ImVec2(90.0f, 0.0f)) && state.editing_profile_index >= 0) {
        const int deleted = state.editing_profile_index;
        state.auth_profiles.erase(state.auth_profiles.begin() + deleted);
        if (state.selected_profile_index == deleted) {
            apply_profile_selection(state, -1);
        } else if (state.selected_profile_index > deleted) {
            state.selected_profile_index -= 1;
            std::string error;
            if (!save_profiles(state, &error)) {
                state.profiles_error_msg = error;
            }
        }
        clear_profile_editor(state);
    }
    ImGui::EndDisabled();
    ImGui::SameLine();
    if (ImGui::Button("Close", ImVec2(90.0f, 0.0f))) {
        ImGui::CloseCurrentPopup();
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    ImGui::SetNextItemWidth(420.0f);
    ImGui::InputTextWithHint("##claude_profile_name", "Profile name", state.profile_name_buffer, IM_ARRAYSIZE(state.profile_name_buffer));
    ImGui::SetNextItemWidth(420.0f);
    ImGui::InputTextWithHint("##claude_profile_api_key", "ANTHROPIC_API_KEY", state.profile_api_key_buffer, IM_ARRAYSIZE(state.profile_api_key_buffer), ImGuiInputTextFlags_Password);
    ImGui::SetNextItemWidth(420.0f);
    ImGui::InputTextWithHint("##claude_profile_auth_token", "ANTHROPIC_AUTH_TOKEN", state.profile_auth_token_buffer, IM_ARRAYSIZE(state.profile_auth_token_buffer), ImGuiInputTextFlags_Password);
    ImGui::SetNextItemWidth(420.0f);
    ImGui::InputTextWithHint("##claude_profile_base_url", "Optional ANTHROPIC_BASE_URL", state.profile_base_url_buffer, IM_ARRAYSIZE(state.profile_base_url_buffer));

    if (!state.profiles_error_msg.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.44f, 0.44f, 1.0f));
        ImGui::TextWrapped("%s", state.profiles_error_msg.c_str());
        ImGui::PopStyleColor();
    }

    if (ImGui::Button(state.editing_profile_index >= 0 ? "Save Changes" : "Add Profile", ImVec2(120.0f, 0.0f))) {
        ClaudeAuthProfile profile;
        profile.name = trim(state.profile_name_buffer);
        profile.api_key = trim(state.profile_api_key_buffer);
        profile.auth_token = trim(state.profile_auth_token_buffer);
        profile.base_url = trim(state.profile_base_url_buffer);

        if (profile.name.empty()) {
            state.profiles_error_msg = "Profile name is required.";
        } else if (profile.api_key.empty() && profile.auth_token.empty()) {
            state.profiles_error_msg = "Provide ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.";
        } else {
            if (state.editing_profile_index >= 0 &&
                state.editing_profile_index < static_cast<int>(state.auth_profiles.size())) {
                state.auth_profiles[static_cast<size_t>(state.editing_profile_index)] = profile;
            } else {
                state.auth_profiles.push_back(profile);
                state.editing_profile_index = static_cast<int>(state.auth_profiles.size()) - 1;
            }

            load_profile_into_editor(state, state.editing_profile_index);
            std::string error;
            if (!save_profiles(state, &error)) {
                state.profiles_error_msg = error;
            } else {
                state.profiles_error_msg.clear();
            }
        }
    }

    ImGui::EndPopup();
}

ClaudePanel::ClaudePanel(core::UIRegistry& registry,
                         core::WorkerPool& worker_pool,
                         std::string state_key)
    : registry_(registry)
    , worker_pool_(worker_pool)
    , state_key_(std::move(state_key))
{
    auto& state = registry_.get_state<ClaudeState>(state_key_);
    state.process = std::make_unique<core::ClaudeProcess>();
}

void ClaudePanel::set_working_dir(const std::string& dir) {
    auto& state = registry_.get_state<ClaudeState>(state_key_);
    state.working_dir = dir;
}

// ── Main render ────────────────────────────────────────────────────────────

void ClaudePanel::render() {
    if (!open_) return;

    if (!install_checked_) {
        installed_ = core::ClaudeProcess::is_installed();
        install_checked_ = true;
    }

    auto& state = registry_.get_state<ClaudeState>(state_key_);
    ensure_profiles_loaded(state);

    process_events(state);

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 12.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, IM_COL32(18, 18, 18, 255));
    ImGui::PushStyleColor(ImGuiCol_Border, IM_COL32(44, 44, 44, 255));

    if (ImGui::BeginChild("##claude_panel", ImVec2(0, 0), true)) {
        if (!installed_) {
            render_not_installed();
        } else {
            // ── Header ─────────────────────────────────────────────────
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
            ImGui::TextUnformatted("Claude Code");
            ImGui::PopStyleColor();

            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
            const char* dir_label = state.working_dir.empty()
                ? "(no directory)" : state.working_dir.c_str();
            ImGui::TextUnformatted(dir_label);
            ImGui::PopStyleColor();
            if (ImGui::IsItemHovered() && !state.working_dir.empty()) {
                ImGui::SetTooltip("%s", state.working_dir.c_str());
            }

            const float combo_w = 170.0f;
            const float manage_w = 66.0f;
            const float button_block_w = 140.0f;
            float right_x = ImGui::GetWindowContentRegionMax().x - (combo_w + manage_w + button_block_w + 24.0f);
            if (right_x > ImGui::GetCursorPosX()) {
                ImGui::SameLine(right_x);
            }
            ImGui::BeginDisabled(state.is_running());
            const std::string active_profile_label =
                state.selected_profile_index >= 0 &&
                state.selected_profile_index < static_cast<int>(state.auth_profiles.size())
                    ? state.auth_profiles[static_cast<size_t>(state.selected_profile_index)].name
                    : "System";
            ImGui::SetNextItemWidth(combo_w);
            if (ImGui::BeginCombo("##claude_profile_combo", active_profile_label.c_str())) {
                const bool system_selected = state.selected_profile_index < 0;
                if (ImGui::Selectable("System", system_selected)) {
                    apply_profile_selection(state, -1);
                }
                for (int i = 0; i < static_cast<int>(state.auth_profiles.size()); ++i) {
                    const bool selected = state.selected_profile_index == i;
                    const std::string& name = state.auth_profiles[static_cast<size_t>(i)].name;
                    if (ImGui::Selectable(name.c_str(), selected)) {
                        apply_profile_selection(state, i);
                    }
                }
                ImGui::EndCombo();
            }
            ImGui::SameLine();
            if (ImGui::Button("Profiles", ImVec2(manage_w, 0.0f))) {
                state.show_profiles_modal = true;
            }
            ImGui::EndDisabled();
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip("Manage Claude auth profiles");
            }
            ImGui::SameLine();
            if (ImGui::SmallButton("New")) {
                new_session(state);
            }
            ImGui::SameLine();
            if (state.is_running() && ImGui::SmallButton("Stop")) {
                state.process->abort();
            }
            if (!state.is_running()) {
                ImGui::SameLine();
                ImGui::Dummy(ImVec2(32.0f, 0.0f));
            }
            ImGui::SameLine();
            if (ImGui::SmallButton("X")) {
                open_ = false;
            }

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            render_profiles_modal(state);

            // ── Message history ────────────────────────────────────────
            const float composer_h = 100.0f;
            const float history_h = std::max(
                60.0f, ImGui::GetContentRegionAvail().y - composer_h);

            if (ImGui::BeginChild("##claude_msgs", ImVec2(0, history_h),
                                  false)) {
                if (state.messages.empty() && !state.is_running()) {
                    ImGui::PushStyleColor(ImGuiCol_Text,
                                          ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
                    ImGui::TextWrapped(
                        "Claude Code can read, edit, and create files, "
                        "run shell commands, search your codebase, and "
                        "more.\n\nIt works in the directory shown above. "
                        "Navigate in the file explorer to change it.");
                    ImGui::PopStyleColor();
                }

                for (size_t i = 0; i < state.messages.size(); ++i) {
                    render_message(static_cast<int>(i), state.messages[i]);
                }

                if (state.is_running()) {
                    const float t = static_cast<float>(ImGui::GetTime());
                    const char* dots[] = {
                        "thinking.", "thinking..", "thinking..."};
                    ImGui::PushStyleColor(ImGuiCol_Text,
                                          ImVec4(0.74f, 0.74f, 0.74f, 1.0f));
                    ImGui::TextUnformatted(
                        dots[static_cast<int>(t * 2.5f) % 3]);
                    ImGui::PopStyleColor();
                }

                if (!state.error_msg.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_Text,
                                          ImVec4(0.90f, 0.44f, 0.44f, 1.0f));
                    ImGui::TextWrapped("%s", state.error_msg.c_str());
                    ImGui::PopStyleColor();
                }

            }
            ImGui::EndChild();

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            // ── Input composer ─────────────────────────────────────────
            if (state.focus_input) {
                ImGui::SetKeyboardFocusHere();
                state.focus_input = false;
            }

            ImGui::PushStyleColor(ImGuiCol_FrameBg, IM_COL32(28, 28, 28, 255));
            ImGui::InputTextMultiline(
                "##claude_input", state.input_buffer,
                IM_ARRAYSIZE(state.input_buffer),
                ImVec2(-80.0f, 60.0f));

            bool send = false;
            if (ImGui::IsItemActive() &&
                ImGui::IsKeyPressed(ImGuiKey_Enter, false) &&
                !ImGui::GetIO().KeyShift) {
                std::string trimmed = trim(state.input_buffer);
                std::snprintf(state.input_buffer,
                              sizeof(state.input_buffer),
                              "%s", trimmed.c_str());
                send = true;
            }
            ImGui::PopStyleColor();

            ImGui::SameLine();
            ImGui::BeginDisabled(state.is_running());
            if (ImGui::Button(state.is_running() ? "..." : "Send",
                              ImVec2(68.0f, 60.0f))) {
                send = true;
            }
            ImGui::EndDisabled();

            if (send && !state.is_running()) {
                submit_message(state);
            }
        }
    }
    ImGui::EndChild();

    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar();
}

// ── Event processing ───────────────────────────────────────────────────────

void ClaudePanel::process_events(ClaudeState& state) {
    if (!state.process) return;

    auto events = state.process->drain_events();
    for (auto& ev : events) {
        switch (ev.type) {
            case core::ClaudeEvent::SYSTEM:
                if (!ev.session_id.empty()) {
                    state.session_id = ev.session_id;
                }
                break;

            case core::ClaudeEvent::TEXT: {
                if (!state.messages.empty() &&
                    state.messages.back().type ==
                        ClaudeDisplayMessage::ASSISTANT_TEXT) {
                    state.messages.back().content += ev.text;
                } else {
                    state.messages.push_back(
                        {ClaudeDisplayMessage::ASSISTANT_TEXT,
                         ev.text, {}, {}, {}});
                }
                break;
            }

            case core::ClaudeEvent::TOOL_USE: {
                ClaudeDisplayMessage msg;
                msg.type = ClaudeDisplayMessage::TOOL_USE;
                msg.content = ev.tool_name;
                msg.tool_name = ev.tool_name;
                msg.tool_input = ev.tool_input;
                state.messages.push_back(std::move(msg));
                break;
            }

            case core::ClaudeEvent::TOOL_RESULT: {
                ClaudeDisplayMessage msg;
                msg.type = ClaudeDisplayMessage::TOOL_RESULT;
                msg.tool_result = ev.tool_result;
                msg.content = ev.tool_result;
                state.messages.push_back(std::move(msg));
                break;
            }

            case core::ClaudeEvent::RESULT:
                if (ev.cost_usd > 0.0) {
                    state.total_cost_usd += ev.cost_usd;
                }
                if (!ev.session_id.empty()) {
                    state.session_id = ev.session_id;
                }
                break;

            case core::ClaudeEvent::ERROR:
                state.error_msg = ev.text;
                break;
        }
    }
}

// ── Submit ─────────────────────────────────────────────────────────────────

void ClaudePanel::submit_message(ClaudeState& state) {
    std::string prompt = trim(state.input_buffer);
    while (!prompt.empty() && prompt.back() == '\n') prompt.pop_back();
    if (prompt.empty()) return;

    state.messages.push_back(
        {ClaudeDisplayMessage::USER, prompt, {}, {}, {}});
    state.error_msg.clear();
    state.input_buffer[0] = '\0';

    if (state.process) {
        std::map<std::string, std::string> env_overrides;
        if (state.selected_profile_index >= 0 &&
            state.selected_profile_index < static_cast<int>(state.auth_profiles.size())) {
            const ClaudeAuthProfile& profile =
                state.auth_profiles[static_cast<size_t>(state.selected_profile_index)];
            env_overrides["ANTHROPIC_API_KEY"] = profile.api_key;
            env_overrides["ANTHROPIC_AUTH_TOKEN"] = profile.auth_token;
            env_overrides["ANTHROPIC_BASE_URL"] = profile.base_url;
        }
        state.process->send_message(prompt, state.working_dir, state.session_id, env_overrides);
    }
}

// ── Message rendering ──────────────────────────────────────────────────────

void ClaudePanel::render_message(int index,
                                 const ClaudeDisplayMessage& msg) {
    ImGui::PushID(index);

    switch (msg.type) {
        case ClaudeDisplayMessage::USER: {
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImVec4(0.65f, 0.65f, 0.65f, 1.0f));
            ImGui::TextUnformatted("You");
            ImGui::PopStyleColor();

            ImGui::BeginGroup();
            ImGui::PushStyleColor(ImGuiCol_ChildBg,
                                  ImVec4(0.20f, 0.20f, 0.20f, 1.0f));
            float wrap = std::max(180.0f,
                ImGui::GetContentRegionAvail().x - 18.0f);
            ImVec2 sz = ImGui::CalcTextSize(
                msg.content.c_str(), nullptr, false, wrap);
            float h = std::max(32.0f, sz.y + 16.0f);
            if (ImGui::BeginChild("##user_bubble", ImVec2(0, h), true,
                                  ImGuiWindowFlags_NoScrollbar)) {
                ImGui::PushStyleColor(ImGuiCol_Text,
                                      ImVec4(0.95f, 0.95f, 0.95f, 1.0f));
                ImGui::TextWrapped("%s", msg.content.c_str());
                ImGui::PopStyleColor();
            }
            ImGui::EndChild();
            ImGui::PopStyleColor();
            ImGui::EndGroup();

            render_copy_button(msg.content);
            break;
        }

        case ClaudeDisplayMessage::ASSISTANT_TEXT: {
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImVec4(0.65f, 0.65f, 0.65f, 1.0f));
            ImGui::TextUnformatted("Claude");
            ImGui::PopStyleColor();

            // Parse and render markdown
            auto blocks = parse_markdown(msg.content);

            ImGui::BeginGroup();
            ImGui::PushStyleColor(ImGuiCol_ChildBg,
                                  ImVec4(0.13f, 0.13f, 0.13f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,
                                ImVec2(10.0f, 10.0f));
            // Estimate height from blocks
            float est_h = 0.0f;
            float avail_w = std::max(180.0f,
                ImGui::GetContentRegionAvail().x - 18.0f);
            for (const auto& b : blocks) {
                ImVec2 sz = ImGui::CalcTextSize(
                    b.text.c_str(), nullptr, false, avail_w);
                float scale = 1.0f;
                if (b.type == BlockType::HEADING) {
                    scale = (b.heading_level == 1) ? 1.4f :
                            (b.heading_level == 2) ? 1.2f : 1.1f;
                }
                est_h += sz.y * scale + 12.0f;
                if (b.type == BlockType::CODE_BLOCK) est_h += 16.0f;
            }
            est_h = std::max(32.0f, est_h + 8.0f);

            if (ImGui::BeginChild("##asst_bubble", ImVec2(0, est_h), true,
                                  ImGuiWindowFlags_NoScrollbar)) {
                render_markdown(blocks);
            }
            ImGui::EndChild();
            ImGui::PopStyleVar();
            ImGui::PopStyleColor();
            ImGui::EndGroup();

            render_copy_button(msg.content);
            break;
        }

        case ClaudeDisplayMessage::TOOL_USE: {
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImVec4(0.55f, 0.75f, 0.95f, 1.0f));
            bool open = ImGui::TreeNode("##tool", "> %s",
                                         msg.tool_name.c_str());
            ImGui::PopStyleColor();
            if (open) {
                if (!msg.tool_input.empty()) {
                    ImGui::BeginGroup();
                    float wrap = std::max(180.0f,
                        ImGui::GetContentRegionAvail().x - 18.0f);
                    ImVec2 sz = ImGui::CalcTextSize(
                        msg.tool_input.c_str(), nullptr, false, wrap);
                    float h = std::max(28.0f, sz.y + 16.0f);

                    ImGui::PushStyleColor(ImGuiCol_ChildBg,
                                          IM_COL32(30, 30, 30, 255));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 4.0f);
                    if (ImGui::BeginChild("##tool_input", ImVec2(0, h),
                                          true, ImGuiWindowFlags_NoScrollbar)) {
                        ImGui::PushStyleColor(ImGuiCol_Text,
                                              ImVec4(0.65f, 0.65f, 0.65f, 1.0f));
                        ImGui::TextWrapped("%s", msg.tool_input.c_str());
                        ImGui::PopStyleColor();
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar();
                    ImGui::PopStyleColor();
                    ImGui::EndGroup();

                    render_copy_button(msg.tool_input);
                }
                ImGui::TreePop();
            }
            break;
        }

        case ClaudeDisplayMessage::TOOL_RESULT: {
            if (!msg.tool_result.empty()) {
                std::string display = msg.tool_result;
                if (display.size() > 500) {
                    display = display.substr(0, 500) + "\n... (truncated)";
                }
                ImGui::PushStyleColor(ImGuiCol_Text,
                                      ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
                bool open = ImGui::TreeNode("##result", "Result");
                ImGui::PopStyleColor();
                if (open) {
                    ImGui::BeginGroup();
                    float wrap = std::max(180.0f,
                        ImGui::GetContentRegionAvail().x - 18.0f);
                    ImVec2 sz = ImGui::CalcTextSize(
                        display.c_str(), nullptr, false, wrap);
                    float h = std::max(28.0f, sz.y + 16.0f);

                    ImGui::PushStyleColor(ImGuiCol_ChildBg,
                                          IM_COL32(30, 30, 30, 255));
                    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 4.0f);
                    if (ImGui::BeginChild("##result_content", ImVec2(0, h),
                                          true, ImGuiWindowFlags_NoScrollbar)) {
                        ImGui::PushStyleColor(ImGuiCol_Text,
                                              ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
                        ImGui::TextWrapped("%s", display.c_str());
                        ImGui::PopStyleColor();
                    }
                    ImGui::EndChild();
                    ImGui::PopStyleVar();
                    ImGui::PopStyleColor();
                    ImGui::EndGroup();

                    render_copy_button(msg.tool_result);
                    ImGui::TreePop();
                }
            }
            break;
        }

        case ClaudeDisplayMessage::SYSTEM_INFO: {
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
            ImGui::TextWrapped("%s", msg.content.c_str());
            ImGui::PopStyleColor();
            break;
        }

        case ClaudeDisplayMessage::ERROR: {
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImVec4(0.90f, 0.44f, 0.44f, 1.0f));
            ImGui::TextWrapped("%s", msg.content.c_str());
            ImGui::PopStyleColor();
            break;
        }
    }

    ImGui::Spacing();
    ImGui::PopID();
}

// ── Helpers ────────────────────────────────────────────────────────────────

void ClaudePanel::render_not_installed() {
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.73f, 0.35f, 1.0f));
    ImGui::TextWrapped("Claude Code is not installed.");
    ImGui::PopStyleColor();

    ImGui::Spacing();
    ImGui::TextWrapped(
        "Install Claude Code:\n\n"
        "  npm install -g @anthropic-ai/claude-code\n\n"
        "Then sign in:\n\n"
        "  claude login\n\n"
        "Requires a Claude account (claude.ai) or Anthropic API key.");

    ImGui::Spacing();
    if (ImGui::Button("Check Again")) {
        installed_ = core::ClaudeProcess::is_installed();
    }
}

void ClaudePanel::new_session(ClaudeState& state) {
    if (state.process) {
        state.process->abort();
    }
    state.session_id.clear();
    state.messages.clear();
    state.error_msg.clear();
    state.total_cost_usd = 0.0;
    state.focus_input = true;
}

} // namespace misty::panel
