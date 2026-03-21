#include "core/commands/command_manager.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <vector>

namespace misty::core {

CommandManager& CommandManager::get() {
    static CommandManager instance;
    return instance;
}

void CommandManager::load() {
    load_defaults();
    load_from_file("commands.msy");
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
    shortcuts_["search.toggle"] = parse_shortcut("Primary+K");
    shortcuts_["search.cancel"] = parse_shortcut("Escape");
    shortcuts_["search.confirm"] = parse_shortcut("Enter");
    shortcuts_["search.prev"] = parse_shortcut("Up");
    shortcuts_["search.next"] = parse_shortcut("Down");

    shortcuts_["explorer.copy"] = parse_shortcut("Primary+C");
    shortcuts_["explorer.cut"] = parse_shortcut("Primary+X");
    shortcuts_["explorer.paste"] = parse_shortcut("Primary+V");
    shortcuts_["explorer.delete"] = parse_shortcut("Delete");
    shortcuts_["explorer.rename"] = parse_shortcut("F2");
    shortcuts_["explorer.refresh"] = parse_shortcut("Primary+R");

    shortcuts_["app.open_settings"] = parse_shortcut("Primary+Comma");
    shortcuts_["auth.submit"] = parse_shortcut("Enter");
    shortcuts_["modal.confirm"] = parse_shortcut("Enter");
    shortcuts_["modal.cancel"] = parse_shortcut("Escape");
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
    const bool primary_down =
#ifdef __APPLE__
        io.KeySuper;
#else
        io.KeyCtrl;
#endif

    if (shortcut.primary && !primary_down) return false;
    if (shortcut.shift != io.KeyShift) return false;
    if (shortcut.alt != io.KeyAlt) return false;
    if (shortcut.ctrl && !io.KeyCtrl) return false;
    if (shortcut.super && !io.KeySuper) return false;

    if (!shortcut.primary && !shortcut.ctrl && io.KeyCtrl) return false;
    if (!shortcut.primary && !shortcut.super && io.KeySuper) return false;

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
