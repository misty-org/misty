#include "core/manager/font_manager.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

namespace misty::core {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

fs::path custom_fonts_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') {
        return {};
    }
    return fs::path(home) / "misty" / "config" / "fonts.json";
}

void merge_custom_fonts(
    ImGuiIO& io,
    float size,
    const std::vector<CustomFontEntry>& custom_fonts
) {
    ImFontConfig merge_cfg;
    merge_cfg.MergeMode = true;
    merge_cfg.PixelSnapH = true;
    const ImWchar* glyph_ranges = io.Fonts->GetGlyphRangesChineseFull();

    for (const auto& font : custom_fonts) {
        if (font.path.empty() || !fs::exists(font.path)) {
            continue;
        }
        io.Fonts->AddFontFromFileTTF(font.path.c_str(), size, &merge_cfg, glyph_ranges);
    }
}

void load_font_family(
    ImGuiIO& io,
    std::unordered_map<FontID, ImFont*>& fonts,
    FontID id,
    const char* path,
    float size,
    const std::vector<CustomFontEntry>& custom_fonts
) {
    fonts[id] = io.Fonts->AddFontFromFileTTF(path, size);
    merge_custom_fonts(io, size, custom_fonts);
}

bool rebuild_fonts(
    std::unordered_map<FontID, ImFont*>& fonts,
    const std::vector<CustomFontEntry>& custom_fonts
) {
    ImGuiIO& io = ImGui::GetIO();

    fonts.clear();
    io.Fonts->Clear();

    load_font_family(io, fonts, FontID::DEFAULT, "assets/fonts/Roboto-Regular.ttf", 18.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_SMALL, "assets/fonts/Roboto-Regular.ttf", 16.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_LARGE, "assets/fonts/Roboto-Regular.ttf", 24.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_XLARGE, "assets/fonts/Roboto-Regular.ttf", 32.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_BOLD, "assets/fonts/Roboto-Bold.ttf", 18.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_BOLD_LARGE, "assets/fonts/Roboto-Bold.ttf", 24.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_BOLD_XLARGE, "assets/fonts/Roboto-Bold.ttf", 32.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_ITALIC, "assets/fonts/Roboto-Italic.ttf", 18.0f, custom_fonts);
    load_font_family(io, fonts, FontID::ROBOTO_BOLD_ITALIC, "assets/fonts/Roboto-BoldItalic.ttf", 18.0f, custom_fonts);

    return true;
}

} // namespace

FontManager& FontManager::get() {
    static FontManager instance;
    return instance;
}

void FontManager::load_fonts() {
    rebuild_fonts(fonts_, load_custom_fonts());
}

bool FontManager::reload_fonts(std::string* error) {
    (void)error;
    return rebuild_fonts(fonts_, load_custom_fonts());
}

void FontManager::queue_reload() {
    reload_pending_ = true;
}

bool FontManager::apply_pending_reload(std::string* error) {
    if (!reload_pending_) {
        return false;
    }

    reload_pending_ = false;
    return reload_fonts(error);
}

std::vector<CustomFontEntry> FontManager::load_custom_fonts() const {
    std::vector<CustomFontEntry> fonts;
    const fs::path path = custom_fonts_path();
    if (path.empty() || !fs::exists(path)) {
        return fonts;
    }

    try {
        std::ifstream file(path);
        json data = json::parse(file);
        if (!data.is_array()) {
            return fonts;
        }

        for (const auto& item : data) {
            CustomFontEntry entry;
            entry.label = item.value("label", "");
            entry.path = item.value("path", "");
            if (!entry.path.empty()) {
                fonts.push_back(std::move(entry));
            }
        }
    } catch (...) {
    }

    return fonts;
}

bool FontManager::save_custom_fonts(
    const std::vector<CustomFontEntry>& fonts,
    std::string* error
) const {
    const fs::path path = custom_fonts_path();
    if (path.empty()) {
        if (error) {
            *error = "Unable to resolve ~/misty/config/fonts.json.";
        }
        return false;
    }

    try {
        fs::create_directories(path.parent_path());
        json data = json::array();
        for (const auto& font : fonts) {
            data.push_back({
                {"label", font.label},
                {"path", font.path},
            });
        }

        std::ofstream file(path);
        if (!file.is_open()) {
            if (error) {
                *error = "Failed to open ~/misty/config/fonts.json for writing.";
            }
            return false;
        }
        file << data.dump(2);
        return true;
    } catch (const std::exception& ex) {
        if (error) {
            *error = ex.what();
        }
        return false;
    }
}

ImFont* FontManager::get_font(FontID font_id) const {
    auto it = fonts_.find(font_id);
    if (it != fonts_.end()) {
        return it->second;
    }

    auto default_it = fonts_.find(FontID::DEFAULT);
    return default_it != fonts_.end() ? default_it->second : nullptr;
}

FontCacheStats FontManager::get_cache_stats() const {
    FontCacheStats stats;
    stats.font_count = fonts_.size();

    const auto custom_fonts = load_custom_fonts();
    stats.custom_font_count = custom_fonts.size();

    ImGuiIO& io = ImGui::GetIO();
    if (io.Fonts->TexData != nullptr) {
        stats.atlas_width = io.Fonts->TexData->Width;
        stats.atlas_height = io.Fonts->TexData->Height;
        stats.atlas_texture_bytes = static_cast<std::size_t>(io.Fonts->TexData->GetSizeInBytes());
    } else if (io.Fonts->TexRef._TexData != nullptr) {
        stats.atlas_width = io.Fonts->TexRef._TexData->Width;
        stats.atlas_height = io.Fonts->TexRef._TexData->Height;
        stats.atlas_texture_bytes =
            static_cast<std::size_t>(io.Fonts->TexRef._TexData->GetSizeInBytes());
    }

    for (const ImFont* font : io.Fonts->Fonts) {
        if (font == nullptr) {
            continue;
        }
        ImFontBaked* baked = const_cast<ImFont*>(font)->GetFontBaked(font->LegacySize);
        if (baked != nullptr) {
            stats.glyph_count += static_cast<std::size_t>(baked->Glyphs.Size);
        }
    }

    return stats;
}

} // namespace misty::core
