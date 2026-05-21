#pragma once

#include <unordered_map>
#include <string>
#include <vector>

#include "imgui.h"

namespace misty::core {

enum class FontID {
    DEFAULT,
    ROBOTO_SMALL,
    ROBOTO_LARGE,
    ROBOTO_XLARGE,
    ROBOTO_BOLD,
    ROBOTO_BOLD_LARGE,
    ROBOTO_BOLD_XLARGE,
    ROBOTO_ITALIC,
    ROBOTO_BOLD_ITALIC,
};

struct CustomFontEntry {
    std::string label;
    std::string path;
};

struct FontCacheStats {
    std::size_t font_count = 0;
    std::size_t custom_font_count = 0;
    std::size_t atlas_texture_bytes = 0;
    int atlas_width = 0;
    int atlas_height = 0;
    std::size_t glyph_count = 0;
};

class FontManager {
public:
    static FontManager& get();

    void load_fonts();
    bool reload_fonts(std::string* error = nullptr);
    void queue_reload();
    bool apply_pending_reload(std::string* error = nullptr);

    std::vector<CustomFontEntry> load_custom_fonts() const;
    bool save_custom_fonts(const std::vector<CustomFontEntry>& fonts, std::string* error = nullptr) const;

    ImFont* get_font(FontID font_id) const;
    FontCacheStats get_cache_stats() const;

private:
    FontManager() = default;
    ~FontManager() = default;

    std::unordered_map<FontID, ImFont*> fonts_;
    bool reload_pending_ = false;
};

} // namespace misty::core
