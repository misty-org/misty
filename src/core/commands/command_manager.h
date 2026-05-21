#pragma once

#include <string>
#include <unordered_map>
#include <utility>
#include <vector>
#include "imgui.h"

namespace misty::core {

class CommandManager {
public:
    static CommandManager& get();

    void load();
    void clear_runtime_commands();
    void register_runtime_command(const std::string& command_id, const std::string& default_shortcut);
    bool matches(const std::string& command_id, bool repeat = false) const;
    std::string label(const std::string& command_id) const;
    std::vector<std::pair<std::string, std::string>> list_shortcuts() const;
    bool save_shortcuts(const std::vector<std::pair<std::string, std::string>>& bindings, std::string* error = nullptr);

private:
    struct Shortcut {
        bool primary = false;
        bool shift = false;
        bool alt = false;
        bool ctrl = false;
        bool super = false;
        ImGuiKey key = ImGuiKey_None;
    };

    CommandManager() = default;

    void load_defaults();
    void load_from_file(const std::string& path);
    static Shortcut parse_shortcut(const std::string& value);
    static std::string trim(const std::string& value);
    static std::string upper(const std::string& value);
    static ImGuiKey parse_key_token(const std::string& token);
    static bool match_shortcut(const Shortcut& shortcut, bool repeat);
    static std::string label_for_shortcut(const Shortcut& shortcut);

    std::unordered_map<std::string, Shortcut> shortcuts_;
    std::unordered_map<std::string, std::string> runtime_shortcuts_;
    std::unordered_map<std::string, std::string> user_shortcut_overrides_;
    bool loaded_ = false;
};

} // namespace misty::core
