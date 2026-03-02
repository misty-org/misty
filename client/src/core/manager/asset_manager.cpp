#include "core/manager/asset_manager.h"
#include "stb_image.h"
#include <glad/glad.h>
#include <fstream>
#include <iostream>
#include <sstream>

namespace misty::core {
    namespace {
        std::size_t rgba_texture_bytes(int width, int height, bool with_mipmaps) {
            if (width <= 0 || height <= 0) {
                return 0;
            }

            const std::size_t base = static_cast<std::size_t>(width) *
                                     static_cast<std::size_t>(height) * 4;
            return with_mipmaps ? (base * 4) / 3 : base;
        }
    }

    void AssetManager::shutdown() {
        for (auto& [name, texture] : svg_textures_) {
            unload_svg(texture);
        }
        svg_textures_.clear();
        for (auto& [name, texture] : image_textures_) {
            if (texture.id != 0) {
                glDeleteTextures(1, &texture.id);
            }
        }
        image_textures_.clear();
    }

    AssetManager& AssetManager::get() {
        static AssetManager instance;
        return instance;
    }

    void AssetManager::load_themes() {
        std::ifstream file("assets/themes/default.css");
        if (file.is_open()) {
            std::stringstream buffer;
            buffer << file.rdbuf();
            current_theme_ = buffer.str();

            // If theme changes, release old textures before clearing the cache.
            for (auto& [_, texture] : svg_textures_) {
                unload_svg(texture);
            }
            svg_textures_.clear();
        }
    }

    const std::string& AssetManager::get_current_theme() const {
        return current_theme_;
    }

    AssetCacheStats AssetManager::get_cache_stats() const {
        AssetCacheStats stats;
        stats.svg_texture_count = svg_textures_.size();
        stats.image_texture_count = image_textures_.size();

        for (const auto& [_, texture] : svg_textures_) {
            stats.svg_texture_bytes += rgba_texture_bytes(texture.width, texture.height, false);
        }
        for (const auto& [_, texture] : image_textures_) {
            stats.image_texture_bytes += rgba_texture_bytes(texture.width, texture.height, true);
        }

        return stats;
    }

    SVGTexture& AssetManager::get_svg_texture(const std::string& name, int size) {
        return get_svg_texture(name, size, size);
    }

    SVGTexture& AssetManager::get_svg_texture(const std::string& name, int width, int height) {
        return get_svg_texture_path("assets/icons/" + name + ".svg", width, height, true);
    }

    SVGTexture& AssetManager::get_svg_texture_path(const std::string& path, int size, bool apply_theme) {
        return get_svg_texture_path(path, size, size, apply_theme);
    }

    SVGTexture& AssetManager::get_svg_texture_path(const std::string& path, int width, int height, bool apply_theme) {
        width = std::max(1, width);
        height = std::max(1, height);
        std::string key = path + "@" + std::to_string(width) + "x" + std::to_string(height) +
            (apply_theme ? "@themed" : "@raw");

        auto it = svg_textures_.find(key);
        if (it != svg_textures_.end()) {
            return it->second;
        }

        SVGTexture tex = load_svg(path, width, height, apply_theme);

        svg_textures_[key] = tex;
        return svg_textures_[key];
    }

    ImageTexture& AssetManager::get_image_texture(const std::string& path) {
        auto it = image_textures_.find(path);
        if (it != image_textures_.end()) {
            return it->second;
        }

        int width, height, channels;
        unsigned char* image_data = stbi_load(path.c_str(), &width, &height, &channels, 4); // Force RGBA

        ImageTexture tex = { 0, 0, 0 };

        if (image_data == nullptr) {
			std::cout << "Failed to load image: " << path << std::endl;
            image_textures_[path] = tex;
            return image_textures_[path];
        }

        GLuint texture;
        glGenTextures(1, &texture);
        glBindTexture(GL_TEXTURE_2D, texture);

        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);

        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, image_data);
        glGenerateMipmap(GL_TEXTURE_2D); // must be called after glTexImage2D

        stbi_image_free(image_data);

        tex.id = texture;
        tex.width = width;
        tex.height = height;

        image_textures_[path] = tex;
        return image_textures_[path];
    }


}
