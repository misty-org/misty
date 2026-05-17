#pragma once

#include <array>
#include <mutex>
#include <string>
#include <vector>

#include "imgui.h"

namespace misty::core {

struct ThemeTokenValue {
    std::string name;
    ImVec4 color;
};

class ThemeManager {
public:
    static ThemeManager& get();

    void initialize_from_settings();
    void apply_current_style(ImGuiStyle& style);
    ImVec4 clear_color() const;

    bool get_color(const std::string& token_name, float out_rgba4[4]);
    bool set_color(const std::string& token_name, const float rgba4[4]);
    bool apply_preset(const std::string& preset_name);

    std::string current_preset() const;
    std::vector<ThemeTokenValue> current_tokens() const;

private:
    ThemeManager() = default;

    struct ThemePreset {
        const char* name;
        const char* label;
        std::array<ThemeTokenValue, 12> tokens;
    };

    static const std::array<ThemePreset, 4>& builtins();
    static ImVec4 mix(const ImVec4& a, const ImVec4& b, float t);
    static ImVec4 multiply_rgb(const ImVec4& color, float factor);
    static std::string normalize_preset_name(const std::string& value);
    void ensure_initialized_locked();
    void apply_current_style_locked(ImGuiStyle& style) const;
    bool load_preset_locked(const std::string& preset_name);
    void persist_locked();
    ThemeTokenValue* find_token_locked(const std::string& token_name);
    const ThemeTokenValue* find_token_locked(const std::string& token_name) const;

    mutable std::mutex mutex_;
    bool initialized_ = false;
    std::string current_preset_ = "misty-dark";
    std::array<ThemeTokenValue, 12> current_tokens_{};
};

} // namespace misty::core
