#include "core/commands/command_manager.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <unordered_set>
#include <vector>

#include "core/system/util.h"

namespace misty::core {

namespace {

std::string trim_copy(const std::string& value) {
    size_t start = 0;
    while (start < value.size() && std::isspace(static_cast<unsigned char>(value[start]))) ++start;
    size_t end = value.size();
    while (end > start && std::isspace(static_cast<unsigned char>(value[end - 1]))) --end;
    return value.substr(start, end - start);
}

struct DefaultCommandEntry {
    const char* id;
    const char* shortcut;
};

const std::vector<DefaultCommandEntry>& default_command_entries() {
#if defined(__APPLE__)
#define MISTY_PRIMARY_SHORTCUT "Cmd"
#else
#define MISTY_PRIMARY_SHORTCUT "Ctrl"
#endif
    static const std::vector<DefaultCommandEntry> entries = {
        {"search.toggle", MISTY_PRIMARY_SHORTCUT "+K"},
        {"search.cancel", "Escape"},
        {"search.confirm", "Enter"},
        {"search.prev", "Up"},
        {"search.next", "Down"},
        {"explorer.copy", MISTY_PRIMARY_SHORTCUT "+C"},
        {"explorer.cut", MISTY_PRIMARY_SHORTCUT "+X"},
        {"explorer.paste", MISTY_PRIMARY_SHORTCUT "+V"},
        {"explorer.delete", "Delete"},
        {"explorer.rename", "F2"},
        {"explorer.refresh", MISTY_PRIMARY_SHORTCUT "+R"},
        {"explorer.toggle_chat", MISTY_PRIMARY_SHORTCUT "+J"},
        {"explorer.toggle_claude", MISTY_PRIMARY_SHORTCUT "+Shift+A"},
        {"explorer.new_tab", MISTY_PRIMARY_SHORTCUT "+T"},
        {"explorer.restore_tab", MISTY_PRIMARY_SHORTCUT "+Shift+T"},
        {"explorer.close_pane", MISTY_PRIMARY_SHORTCUT "+D"},
        {"explorer.restore_pane", MISTY_PRIMARY_SHORTCUT "+Ctrl+Backslash"},
        {"explorer.split_vertical", MISTY_PRIMARY_SHORTCUT "+Backslash"},
        {"explorer.split_horizontal", MISTY_PRIMARY_SHORTCUT "+Shift+Backslash"},
        {"explorer.tab_1", MISTY_PRIMARY_SHORTCUT "+1"},
        {"explorer.tab_2", MISTY_PRIMARY_SHORTCUT "+2"},
        {"explorer.tab_3", MISTY_PRIMARY_SHORTCUT "+3"},
        {"explorer.tab_4", MISTY_PRIMARY_SHORTCUT "+4"},
        {"explorer.tab_5", MISTY_PRIMARY_SHORTCUT "+5"},
        {"explorer.tab_6", MISTY_PRIMARY_SHORTCUT "+6"},
        {"explorer.tab_7", MISTY_PRIMARY_SHORTCUT "+7"},
        {"explorer.tab_8", MISTY_PRIMARY_SHORTCUT "+8"},
        {"explorer.tab_9", MISTY_PRIMARY_SHORTCUT "+9"},
        {"app.open_settings", MISTY_PRIMARY_SHORTCUT "+Comma"},
        {"auth.submit", "Enter"},
        {"modal.confirm", "Enter"},
        {"modal.cancel", "Escape"},
    };
#undef MISTY_PRIMARY_SHORTCUT
    return entries;
}

std::filesystem::path user_commands_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') {
        return {};
    }
    return std::filesystem::path(home) / "misty" / "config" / "commands.msy";
}

void ensure_user_commands_file(const std::filesystem::path& user_path) {
    if (user_path.empty() || std::filesystem::exists(user_path)) {
        return;
    }

    std::error_code ec;
    std::filesystem::create_directories(user_path.parent_path(), ec);
    if (ec) {
        return;
    }

    std::ofstream file(user_path);
    if (!file.is_open()) {
        return;
    }

    file << "# Misty keyboard commands\n";
    file << "# Runtime source of truth: ~/misty/config/commands.msy\n";
    file << "# Format: command.id = Shortcut\n";
    file << "# Modifiers: Cmd, Ctrl, Shift, Alt\n\n";

    for (const auto& entry : default_command_entries()) {
        file << entry.id << " = " << entry.shortcut << "\n";
    }
}

void sync_missing_user_commands(const std::filesystem::path& user_path) {
    if (user_path.empty() || !std::filesystem::exists(user_path)) {
        return;
    }

    std::ifstream input(user_path);
    if (!input.is_open()) {
        return;
    }

    std::unordered_set<std::string> existing_keys;
    std::string line;
    while (std::getline(input, line)) {
        const std::string trimmed = trim_copy(line);
        if (trimmed.empty() || trimmed[0] == '#') {
            continue;
        }

        const size_t eq = trimmed.find('=');
        if (eq == std::string::npos) {
            continue;
        }

        const std::string key = trim_copy(trimmed.substr(0, eq));
        if (!key.empty()) {
            existing_keys.insert(key);
        }
    }

    std::ofstream output(user_path, std::ios::app);
    if (!output.is_open()) {
        return;
    }

    bool wrote_header = false;
    for (const auto& entry : default_command_entries()) {
        if (existing_keys.contains(entry.id)) {
            continue;
        }
        if (!wrote_header) {
            output << "\n# Added automatically after upgrading Misty\n";
            wrote_header = true;
        }
        output << entry.id << " = " << entry.shortcut << "\n";
    }
}

} // namespace

CommandManager& CommandManager::get() {
    static CommandManager instance;
    return instance;
}

void CommandManager::load() {
    load_defaults();

    const std::filesystem::path user_path = user_commands_path();
    ensure_user_commands_file(user_path);
    sync_missing_user_commands(user_path);

    user_shortcut_overrides_.clear();
    if (!user_path.empty() && std::filesystem::exists(user_path)) {
        load_from_file(user_path.string());
    }
    loaded_ = true;
}

void CommandManager::clear_runtime_commands() {
    if (loaded_) {
        for (const auto& [command_id, _] : runtime_shortcuts_) {
            shortcuts_.erase(command_id);
        }
    }
    runtime_shortcuts_.clear();
}

void CommandManager::register_runtime_command(const std::string& command_id, const std::string& default_shortcut) {
    if (command_id.empty() || default_shortcut.empty()) {
        return;
    }

    runtime_shortcuts_[command_id] = default_shortcut;
    if (!loaded_) {
        return;
    }

    auto user_it = user_shortcut_overrides_.find(command_id);
    const std::string& shortcut_value = user_it != user_shortcut_overrides_.end()
        ? user_it->second
        : default_shortcut;
    shortcuts_[command_id] = parse_shortcut(shortcut_value);
}

bool CommandManager::matches(const std::string& command_id, bool repeat) const {
    auto it = shortcuts_.find(command_id);
    if (it == shortcuts_.end()) return false;
    return match_shortcut(it->second, repeat);
}

std::string CommandManager::label(const std::string& command_id) const {
    auto it = shortcuts_.find(command_id);
    if (it == shortcuts_.end()) return "";
    return label_for_shortcut(it->second);
}

void CommandManager::load_defaults() {
    shortcuts_.clear();
    for (const auto& entry : default_command_entries()) {
        shortcuts_[entry.id] = parse_shortcut(entry.shortcut);
    }
    for (const auto& [command_id, shortcut] : runtime_shortcuts_) {
        shortcuts_[command_id] = parse_shortcut(shortcut);
    }
}

void CommandManager::load_from_file(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) return;

    std::string line;
    while (std::getline(file, line)) {
        std::string trimmed = trim(line);
        if (trimmed.empty() || trimmed[0] == '#') continue;

        size_t eq = trimmed.find('=');
        if (eq == std::string::npos) continue;

        std::string key = trim(trimmed.substr(0, eq));
        std::string value = trim(trimmed.substr(eq + 1));
        if (key.empty() || value.empty()) continue;

        user_shortcut_overrides_[key] = value;
        shortcuts_[key] = parse_shortcut(value);
    }
}

CommandManager::Shortcut CommandManager::parse_shortcut(const std::string& value) {
    Shortcut shortcut;

    std::stringstream ss(value);
    std::string token;
    while (std::getline(ss, token, '+')) {
        std::string normalized = upper(trim(token));
        if (normalized.empty()) continue;

        if (normalized == "PRIMARY") shortcut.primary = true;
        else if (normalized == "SHIFT") shortcut.shift = true;
        else if (normalized == "ALT" || normalized == "OPTION") shortcut.alt = true;
        else if (normalized == "CTRL" || normalized == "CONTROL") shortcut.ctrl = true;
        else if (normalized == "CMD" || normalized == "COMMAND" || normalized == "SUPER") shortcut.super = true;
        else shortcut.key = parse_key_token(normalized);
    }

    return shortcut;
}

std::string CommandManager::trim(const std::string& value) {
    size_t start = 0;
    while (start < value.size() && std::isspace(static_cast<unsigned char>(value[start]))) ++start;
    size_t end = value.size();
    while (end > start && std::isspace(static_cast<unsigned char>(value[end - 1]))) --end;
    return value.substr(start, end - start);
}

std::string CommandManager::upper(const std::string& value) {
    std::string out = value;
    std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) {
        return static_cast<char>(std::toupper(c));
    });
    return out;
}

ImGuiKey CommandManager::parse_key_token(const std::string& token) {
    if (token == "ENTER" || token == "RETURN") return ImGuiKey_Enter;
    if (token == "ESC" || token == "ESCAPE") return ImGuiKey_Escape;
    if (token == "UP" || token == "UPARROW") return ImGuiKey_UpArrow;
    if (token == "DOWN" || token == "DOWNARROW") return ImGuiKey_DownArrow;
    if (token == "LEFT" || token == "LEFTARROW") return ImGuiKey_LeftArrow;
    if (token == "RIGHT" || token == "RIGHTARROW") return ImGuiKey_RightArrow;
    if (token == "DELETE" || token == "DEL") return ImGuiKey_Delete;
    if (token == "COMMA" || token == ",") return ImGuiKey_Comma;
    if (token == "EQUAL" || token == "PLUS" || token == "=") return ImGuiKey_Equal;
    if (token == "MINUS" || token == "HYPHEN" || token == "-") return ImGuiKey_Minus;
    if (token == "LEFTBRACKET" || token == "[") return ImGuiKey_LeftBracket;
    if (token == "RIGHTBRACKET" || token == "]") return ImGuiKey_RightBracket;
    if (token == "BACKSLASH" || token == "\\") return ImGuiKey_Backslash;
    if (token == "F2") return ImGuiKey_F2;
    if (token.size() == 1) {
        char c = token[0];
        if (c >= 'A' && c <= 'Z') return static_cast<ImGuiKey>(ImGuiKey_A + (c - 'A'));
        if (c >= '0' && c <= '9') return static_cast<ImGuiKey>(ImGuiKey_0 + (c - '0'));
    }
    return ImGuiKey_None;
}

bool CommandManager::match_shortcut(const Shortcut& shortcut, bool repeat) {
    if (shortcut.key == ImGuiKey_None) return false;

    ImGuiIO& io = ImGui::GetIO();
#ifdef __APPLE__
    const bool command_down = io.KeyCtrl;
    const bool control_down = io.KeySuper;
    const bool primary_down = command_down;
#else
    const bool command_down = io.KeySuper;
    const bool control_down = io.KeyCtrl;
    const bool primary_down = io.KeyCtrl;
#endif

    if (shortcut.primary && !primary_down) return false;
    if (shortcut.shift != io.KeyShift) return false;
    if (shortcut.alt != io.KeyAlt) return false;
    if (shortcut.ctrl && !control_down) return false;
    if (shortcut.super && !command_down) return false;

    if (!shortcut.primary && !shortcut.ctrl && control_down) return false;
    if (!shortcut.primary && !shortcut.super && command_down) return false;

    if (shortcut.key == ImGuiKey_Enter) {
        return ImGui::IsKeyPressed(ImGuiKey_Enter, repeat) || ImGui::IsKeyPressed(ImGuiKey_KeypadEnter, repeat);
    }
    return ImGui::IsKeyPressed(shortcut.key, repeat);
}

std::string CommandManager::label_for_shortcut(const Shortcut& shortcut) {
    std::vector<std::string> parts;
    if (shortcut.primary) {
#ifdef __APPLE__
        parts.emplace_back("Cmd");
#else
        parts.emplace_back("Ctrl");
#endif
    }
    if (shortcut.ctrl) parts.emplace_back("Ctrl");
    if (shortcut.super) parts.emplace_back("Cmd");
    if (shortcut.shift) parts.emplace_back("Shift");
    if (shortcut.alt) parts.emplace_back("Alt");

    switch (shortcut.key) {
        case ImGuiKey_Enter: parts.emplace_back("Enter"); break;
        case ImGuiKey_Escape: parts.emplace_back("Escape"); break;
        case ImGuiKey_UpArrow: parts.emplace_back("Up"); break;
        case ImGuiKey_DownArrow: parts.emplace_back("Down"); break;
        case ImGuiKey_Delete: parts.emplace_back("Delete"); break;
        case ImGuiKey_Comma: parts.emplace_back(","); break;
        case ImGuiKey_Equal: parts.emplace_back("="); break;
        case ImGuiKey_Minus: parts.emplace_back("-"); break;
        case ImGuiKey_LeftBracket: parts.emplace_back("["); break;
        case ImGuiKey_RightBracket: parts.emplace_back("]"); break;
        case ImGuiKey_Backslash: parts.emplace_back("\\"); break;
        case ImGuiKey_F2: parts.emplace_back("F2"); break;
        default:
            if (shortcut.key >= ImGuiKey_A && shortcut.key <= ImGuiKey_Z) {
                parts.emplace_back(std::string(1, static_cast<char>('A' + (shortcut.key - ImGuiKey_A))));
            } else if (shortcut.key >= ImGuiKey_0 && shortcut.key <= ImGuiKey_9) {
                parts.emplace_back(std::string(1, static_cast<char>('0' + (shortcut.key - ImGuiKey_0))));
            }
            break;
    }

    std::string result;
    for (size_t i = 0; i < parts.size(); ++i) {
        if (i != 0) result += "+";
        result += parts[i];
    }
    return result;
}

} // namespace misty::core
