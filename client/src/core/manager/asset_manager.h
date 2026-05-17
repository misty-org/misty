#pragma once
#include <string>
#include <glad/glad.h>
#include <unordered_map>
#include <cstdint>

#include "core/ui/svg_loader.h"

namespace misty::core {
    struct ImageTexture {
        GLuint id;
        int width;
        int height;
    };

    struct AssetCacheStats {
        std::size_t svg_texture_count = 0;
        std::size_t image_texture_count = 0;
        std::size_t svg_texture_bytes = 0;
        std::size_t image_texture_bytes = 0;
    };

    class AssetManager {
    public:
        static AssetManager& get();

        void load_themes();

        SVGTexture& get_svg_texture(const std::string& name, int size = 24);
        SVGTexture& get_svg_texture(const std::string& name, int width, int height);
        SVGTexture& get_svg_texture_path(const std::string& path, int size = 24, bool apply_theme = true);
        SVGTexture& get_svg_texture_path(const std::string& path, int width, int height, bool apply_theme = true);

        ImageTexture& get_image_texture(const std::string& path);

        const std::string& get_current_theme() const;
        AssetCacheStats get_cache_stats() const;

        void shutdown();

    private:
        struct SvgCacheEntry {
            SVGTexture texture{};
            std::size_t approx_bytes = 0;
            std::uint64_t last_used = 0;
            bool pinned = false;
        };

        struct ImageCacheEntry {
            ImageTexture texture{0, 0, 0};
            std::size_t approx_bytes = 0;
            std::uint64_t last_used = 0;
            bool pinned = false;
        };

        void touch_svg(const std::string& key);
        void touch_image(const std::string& key);
        void prune_svg_cache();
        void prune_image_cache();

        AssetManager() = default;
        ~AssetManager() = default;

        std::string current_theme_;
        std::unordered_map<std::string, SvgCacheEntry> svg_textures_;
        std::unordered_map<std::string, ImageCacheEntry> image_textures_;
        std::uint64_t use_tick_ = 0;

        static constexpr std::size_t kMaxSvgTextures = 96;
        static constexpr std::size_t kMaxImageBytes = 16 * 1024 * 1024;
    };
}
