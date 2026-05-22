#include "core/manager/theme_manager.h"

#include <algorithm>
#include <cctype>

#include <nlohmann/json.hpp>

#include "core/manager/settings_manager.h"

namespace misty::core {
namespace {

using json = nlohmann::json;

ThemeTokenValue token(const char* name, const ImVec4& color) {
    return ThemeTokenValue{std::string(name), color};
}

json color_to_json(const ImVec4& color) {
    return json::array({color.x, color.y, color.z, color.w});
}

bool json_to_color(const json& value, ImVec4* out) {
    if (!out || !value.is_array() || value.size() != 4) {
        return false;
    }
    *out = ImVec4(
        value[0].get<float>(),
        value[1].get<float>(),
        value[2].get<float>(),
        value[3].get<float>());
    return true;
}

} // namespace

ThemeManager& ThemeManager::get() {
    static ThemeManager instance;
    return instance;
}

const std::array<ThemeManager::ThemePreset, 4>& ThemeManager::builtins() {
    static const std::array<ThemePreset, 4> presets = {{
        ThemePreset{
            "misty-dark",
            "Misty Dark",
            {
                token("window_bg", ImVec4(0.067f, 0.067f, 0.075f, 1.0f)),
                token("panel_bg", ImVec4(0.094f, 0.094f, 0.106f, 1.0f)),
                token("panel_alt_bg", ImVec4(0.153f, 0.153f, 0.165f, 1.0f)),
                token("border", ImVec4(0.153f, 0.153f, 0.165f, 1.0f)),
                token("text", ImVec4(0.831f, 0.831f, 0.847f, 1.0f)),
                token("text_muted", ImVec4(0.443f, 0.443f, 0.478f, 1.0f)),
                token("accent", ImVec4(0.231f, 0.510f, 0.965f, 1.0f)),
                token("accent_hover", ImVec4(0.145f, 0.388f, 0.922f, 1.0f)),
                token("selection", ImVec4(0.231f, 0.510f, 0.965f, 0.35f)),
                token("success", ImVec4(0.161f, 0.733f, 0.533f, 1.0f)),
                token("warning", ImVec4(0.969f, 0.631f, 0.204f, 1.0f)),
                token("error", ImVec4(0.937f, 0.267f, 0.267f, 1.0f)),
            },
        },
        ThemePreset{
            "gruvbox-dark",
            "Gruvbox Dark",
            {
                token("window_bg", ImVec4(0.157f, 0.157f, 0.157f, 1.0f)),   // #282828
                token("panel_bg", ImVec4(0.235f, 0.220f, 0.212f, 1.0f)),    // #3c3836
                token("panel_alt_bg", ImVec4(0.314f, 0.286f, 0.271f, 1.0f)),// #504945
                token("border", ImVec4(0.412f, 0.376f, 0.353f, 1.0f)),      // softened bg4
                token("text", ImVec4(0.922f, 0.859f, 0.698f, 1.0f)),        // #ebdbb2
                token("text_muted", ImVec4(0.835f, 0.769f, 0.631f, 1.0f)),  // #d5c4a1
                token("accent", ImVec4(0.514f, 0.647f, 0.596f, 1.0f)),      // #83a598
                token("accent_hover", ImVec4(0.271f, 0.522f, 0.522f, 1.0f)),// #458588
                token("selection", ImVec4(0.514f, 0.647f, 0.596f, 0.35f)),
                token("success", ImVec4(0.722f, 0.733f, 0.149f, 1.0f)),     // #b8bb26
                token("warning", ImVec4(0.980f, 0.741f, 0.184f, 1.0f)),     // #fabd2f
                token("error", ImVec4(0.984f, 0.286f, 0.204f, 1.0f)),       // #fb4934
            },
        },
        ThemePreset{
            "tokyo-night",
            "Tokyo Night",
            {
                token("window_bg", ImVec4(0.102f, 0.110f, 0.176f, 1.0f)),   // #1a1b2e
                token("panel_bg", ImVec4(0.149f, 0.157f, 0.239f, 1.0f)),    // #24283b
                token("panel_alt_bg", ImVec4(0.255f, 0.271f, 0.431f, 1.0f)),// #414868
                token("border", ImVec4(0.333f, 0.353f, 0.561f, 1.0f)),      // #565f89
                token("text", ImVec4(0.753f, 0.780f, 0.976f, 1.0f)),        // #c0caf5
                token("text_muted", ImVec4(0.659f, 0.706f, 0.902f, 1.0f)),  // #a9b1d6
                token("accent", ImVec4(0.478f, 0.525f, 0.992f, 1.0f)),      // #7aa2f7
                token("accent_hover", ImVec4(0.176f, 0.439f, 0.729f, 1.0f)),// #2ac3de-ish blue
                token("selection", ImVec4(0.478f, 0.525f, 0.992f, 0.35f)),
                token("success", ImVec4(0.620f, 0.796f, 0.345f, 1.0f)),     // #9ece6a
                token("warning", ImVec4(0.878f, 0.592f, 0.365f, 1.0f)),     // #e0af68
                token("error", ImVec4(0.969f, 0.380f, 0.576f, 1.0f)),       // #f7768e
            },
        },
        ThemePreset{
            "catppuccin-mocha",
            "Catppuccin Mocha",
            {
                token("window_bg", ImVec4(0.118f, 0.118f, 0.180f, 1.0f)),   // #1e1e2e
                token("panel_bg", ImVec4(0.141f, 0.141f, 0.216f, 1.0f)),    // #24273a-ish / mantle blend
                token("panel_alt_bg", ImVec4(0.188f, 0.192f, 0.282f, 1.0f)),// #303446-ish elevated
                token("border", ImVec4(0.424f, 0.447f, 0.612f, 1.0f)),      // #6c7086
                token("text", ImVec4(0.804f, 0.839f, 0.957f, 1.0f)),        // #cdd6f4
                token("text_muted", ImVec4(0.651f, 0.678f, 0.788f, 1.0f)),  // #a6adc8
                token("accent", ImVec4(0.537f, 0.706f, 0.980f, 1.0f)),      // #89b4fa
                token("accent_hover", ImVec4(0.454f, 0.780f, 0.925f, 1.0f)),// #74c7ec
                token("selection", ImVec4(0.537f, 0.706f, 0.980f, 0.35f)),
                token("success", ImVec4(0.651f, 0.890f, 0.631f, 1.0f)),     // #a6e3a1
                token("warning", ImVec4(0.980f, 0.831f, 0.529f, 1.0f)),     // #f9e2af
                token("error", ImVec4(0.949f, 0.545f, 0.659f, 1.0f)),       // #f38ba8
            },
        },
    }};
    return presets;
}

ImVec4 ThemeManager::mix(const ImVec4& a, const ImVec4& b, float t) {
    const float clamped = std::clamp(t, 0.0f, 1.0f);
    return ImVec4(
        a.x + (b.x - a.x) * clamped,
        a.y + (b.y - a.y) * clamped,
        a.z + (b.z - a.z) * clamped,
        a.w + (b.w - a.w) * clamped);
}

ImVec4 ThemeManager::multiply_rgb(const ImVec4& color, float factor) {
    return ImVec4(
        std::clamp(color.x * factor, 0.0f, 1.0f),
        std::clamp(color.y * factor, 0.0f, 1.0f),
        std::clamp(color.z * factor, 0.0f, 1.0f),
        color.w);
}

std::string ThemeManager::normalize_preset_name(const std::string& value) {
    std::string out;
    out.reserve(value.size());
    for (char ch : value) {
        if (std::isspace(static_cast<unsigned char>(ch))) {
            out.push_back('-');
        } else {
            out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
        }
    }
    return out;
}

void ThemeManager::initialize_from_settings() {
    std::lock_guard<std::mutex> lock(mutex_);
    ensure_initialized_locked();
}

void ThemeManager::ensure_initialized_locked() {
    if (initialized_) {
        return;
    }

    load_preset_locked("misty-dark");

    const json settings = load_settings_document();
    const json appearance = settings.value("appearance", json::object());
    const json custom_theme = appearance.value("custom_theme", json::object());

    const std::string preset = normalize_preset_name(
        custom_theme.value("preset", std::string(current_preset_)));
    if (!preset.empty()) {
        load_preset_locked(preset);
    }

    const json token_overrides = custom_theme.value("tokens", json::object());
    if (token_overrides.is_object()) {
        for (auto it = token_overrides.begin(); it != token_overrides.end(); ++it) {
            if (ThemeTokenValue* entry = find_token_locked(it.key())) {
                ImVec4 color;
                if (json_to_color(it.value(), &color)) {
                    entry->color = color;
                }
            }
        }
    }

    initialized_ = true;
}

bool ThemeManager::load_preset_locked(const std::string& preset_name) {
    const std::string normalized = normalize_preset_name(preset_name);
    for (const auto& preset : builtins()) {
        if (normalized == preset.name) {
            current_preset_ = preset.name;
            current_tokens_ = preset.tokens;
            return true;
        }
    }
    return false;
}

void ThemeManager::persist_locked() {
    std::array<ThemeTokenValue, 12> tokens = current_tokens_;
    const std::string preset = current_preset_;
    update_settings_document([&](json& settings) {
        settings["schema_version"] = 1;
        json& appearance = settings["appearance"];
        if (!appearance.is_object()) {
            appearance = json::object();
        }

        json token_json = json::object();
        for (const auto& entry : tokens) {
            token_json[entry.name] = color_to_json(entry.color);
        }

        appearance["custom_theme"] = {
            {"preset", preset},
            {"tokens", token_json},
        };
    });
}

ThemeTokenValue* ThemeManager::find_token_locked(const std::string& token_name) {
    const auto it = std::find_if(current_tokens_.begin(), current_tokens_.end(),
        [&](const ThemeTokenValue& entry) { return entry.name == token_name; });
    return it == current_tokens_.end() ? nullptr : &(*it);
}

const ThemeTokenValue* ThemeManager::find_token_locked(const std::string& token_name) const {
    const auto it = std::find_if(current_tokens_.begin(), current_tokens_.end(),
        [&](const ThemeTokenValue& entry) { return entry.name == token_name; });
    return it == current_tokens_.end() ? nullptr : &(*it);
}

bool ThemeManager::get_color(const std::string& token_name, float out_rgba4[4]) {
    if (!out_rgba4) {
        return false;
    }

    std::lock_guard<std::mutex> lock(mutex_);
    ensure_initialized_locked();
    const ThemeTokenValue* entry = find_token_locked(token_name);
    if (!entry) {
        return false;
    }

    out_rgba4[0] = entry->color.x;
    out_rgba4[1] = entry->color.y;
    out_rgba4[2] = entry->color.z;
    out_rgba4[3] = entry->color.w;
    return true;
}

bool ThemeManager::set_color(const std::string& token_name, const float rgba4[4]) {
    if (!rgba4) {
        return false;
    }

    std::lock_guard<std::mutex> lock(mutex_);
    ensure_initialized_locked();
    ThemeTokenValue* entry = find_token_locked(token_name);
    if (!entry) {
        return false;
    }

    entry->color = ImVec4(
        std::clamp(rgba4[0], 0.0f, 1.0f),
        std::clamp(rgba4[1], 0.0f, 1.0f),
        std::clamp(rgba4[2], 0.0f, 1.0f),
        std::clamp(rgba4[3], 0.0f, 1.0f));
    current_preset_ = "custom";
    persist_locked();
    apply_current_style_locked(ImGui::GetStyle());
    return true;
}

bool ThemeManager::apply_preset(const std::string& preset_name) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensure_initialized_locked();
    if (!load_preset_locked(preset_name)) {
        return false;
    }
    persist_locked();
    apply_current_style_locked(ImGui::GetStyle());
    return true;
}

std::string ThemeManager::current_preset() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return current_preset_;
}

std::vector<ThemeTokenValue> ThemeManager::current_tokens() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return std::vector<ThemeTokenValue>(current_tokens_.begin(), current_tokens_.end());
}

void ThemeManager::apply_current_style(ImGuiStyle& style) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensure_initialized_locked();
    apply_current_style_locked(style);
}

void ThemeManager::apply_current_style_locked(ImGuiStyle& style) const {
    const ThemeTokenValue* window_bg_entry = find_token_locked("window_bg");
    const ThemeTokenValue* panel_bg_entry = find_token_locked("panel_bg");
    const ThemeTokenValue* panel_alt_bg_entry = find_token_locked("panel_alt_bg");
    const ThemeTokenValue* border_entry = find_token_locked("border");
    const ThemeTokenValue* text_entry = find_token_locked("text");
    const ThemeTokenValue* text_muted_entry = find_token_locked("text_muted");
    const ThemeTokenValue* accent_entry = find_token_locked("accent");
    const ThemeTokenValue* accent_hover_entry = find_token_locked("accent_hover");
    const ThemeTokenValue* selection_entry = find_token_locked("selection");

    if (!window_bg_entry || !panel_bg_entry || !panel_alt_bg_entry || !border_entry ||
        !text_entry || !text_muted_entry || !accent_entry || !accent_hover_entry ||
        !selection_entry) {
        return;
    }

    const ImVec4 window_bg = window_bg_entry->color;
    const ImVec4 panel_bg = panel_bg_entry->color;
    const ImVec4 panel_alt_bg = panel_alt_bg_entry->color;
    const ImVec4 border = border_entry->color;
    const ImVec4 text = text_entry->color;
    const ImVec4 text_muted = text_muted_entry->color;
    const ImVec4 accent = accent_entry->color;
    const ImVec4 accent_hover = accent_hover_entry->color;
    const ImVec4 selection = selection_entry->color;

    style.FrameRounding = 8.0f;
    style.GrabRounding = 8.0f;
    style.ScrollbarRounding = 6.0f;
    style.WindowRounding = 0.0f;
    style.PopupRounding = 0.0f;
    style.ScrollbarSize = 12.0f;
    style.ScrollbarPadding = 0.0f;

    style.Colors[ImGuiCol_Text] = text;
    style.Colors[ImGuiCol_TextDisabled] = text_muted;
    style.Colors[ImGuiCol_WindowBg] = window_bg;
    style.Colors[ImGuiCol_PopupBg] = panel_bg;
    style.Colors[ImGuiCol_Border] = border;
    style.Colors[ImGuiCol_FrameBg] = panel_bg;
    style.Colors[ImGuiCol_FrameBgHovered] = mix(panel_bg, accent_hover, 0.25f);
    style.Colors[ImGuiCol_FrameBgActive] = mix(panel_bg, accent, 0.35f);
    style.Colors[ImGuiCol_TitleBg] = multiply_rgb(window_bg, 0.55f);
    style.Colors[ImGuiCol_TitleBgActive] = panel_bg;
    style.Colors[ImGuiCol_MenuBarBg] = window_bg;
    style.Colors[ImGuiCol_ScrollbarBg] = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    style.Colors[ImGuiCol_ScrollbarGrab] = border;
    style.Colors[ImGuiCol_ScrollbarGrabHovered] = panel_alt_bg;
    style.Colors[ImGuiCol_ScrollbarGrabActive] = accent;
    style.Colors[ImGuiCol_CheckMark] = accent;
    style.Colors[ImGuiCol_SliderGrab] = accent;
    style.Colors[ImGuiCol_SliderGrabActive] = accent_hover;
    style.Colors[ImGuiCol_Button] = panel_alt_bg;
    style.Colors[ImGuiCol_ButtonHovered] = mix(panel_alt_bg, accent_hover, 0.20f);
    style.Colors[ImGuiCol_ButtonActive] = mix(panel_alt_bg, accent, 0.28f);
    style.Colors[ImGuiCol_Header] = panel_alt_bg;
    style.Colors[ImGuiCol_HeaderHovered] = mix(panel_alt_bg, accent_hover, 0.22f);
    style.Colors[ImGuiCol_HeaderActive] = mix(panel_alt_bg, accent, 0.30f);
    style.Colors[ImGuiCol_Separator] = border;
    style.Colors[ImGuiCol_Tab] = panel_bg;
    style.Colors[ImGuiCol_TabHovered] = mix(panel_bg, accent_hover, 0.20f);
    style.Colors[ImGuiCol_TabSelected] = mix(panel_bg, accent, 0.28f);
    style.Colors[ImGuiCol_NavHighlight] = selection;
    style.Colors[ImGuiCol_TextSelectedBg] = selection;
}

ImVec4 ThemeManager::clear_color() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!initialized_) {
        return ImVec4(0.035f, 0.035f, 0.043f, 1.0f);
    }
    const ThemeTokenValue* entry = find_token_locked("window_bg");
    return entry ? entry->color : ImVec4(0.035f, 0.035f, 0.043f, 1.0f);
}

} // namespace misty::core
