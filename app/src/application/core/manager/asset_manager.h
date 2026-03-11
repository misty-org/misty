#pragma once
#include <string>
#include <unordered_map>
#include <glad/glad.h>
#include "imgui.h"
#include "core/ui/svg_loader.h"




namespace misty::core {
    enum class FontID {
        DEFAULT,
        ROBOTO_SMALL,
        ROBOTO_LARGE
    };

    struct ImageTexture {
        GLuint id;
        int width;
        int height;
    };

    class AssetManager {
    public:
        static AssetManager& get();

        void load_fonts();

        void load_themes();

        SVGTexture& get_svg_texture(const std::string& name, int size = 24);

        ImageTexture& get_image_texture(const std::string& path);

        const std::string& get_current_theme() const;

        ImFont* get_font(const FontID& fond_id) const;

        void shutdown();

    private:
        AssetManager() = default;
        ~AssetManager() = default;

        std::string current_theme_;
        std::unordered_map<FontID, ImFont*> fonts_;
        std::unordered_map<std::string, SVGTexture> svg_textures_;
        std::unordered_map<std::string, ImageTexture> image_textures_;
    };
}