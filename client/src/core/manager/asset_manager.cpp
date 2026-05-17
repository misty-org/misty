#include "core/manager/asset_manager.h"
#include "stb_image.h"
#include <glad/glad.h>
#include <fstream>
#include <iostream>
#include <sstream>
#include <vector>

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

        bool is_pinned_svg_key(const std::string& key) {
            static const std::vector<std::string> pinned = {
                "assets/icons/file-directory-24.svg",
                "assets/icons/devices-24.svg",
                "assets/icons/apps-16.svg",
                "assets/icons/shield-lock-24.svg",
                "assets/icons/transfer-24.svg",
                "assets/icons/gear-24.svg",
                "assets/icons/bell-24.svg",
                "assets/icons/file-directory-fill-16.svg",
                "assets/icons/file-directory-open-fill-24.svg",
                "assets/icons/file-16.svg",
            };
            for (const std::string& prefix : pinned) {
                if (key.find(prefix) != std::string::npos) {
                    return true;
                }
            }
            return false;
        }

        bool is_pinned_image_key(const std::string& key) {
            return key == "assets/logos/misty.png" ||
                   key == "assets/animations/misty_sprite.png";
        }
    }

    void AssetManager::shutdown() {
        for (auto& [name, entry] : svg_textures_) {
            unload_svg(entry.texture);
        }
        svg_textures_.clear();
        for (auto& [name, entry] : image_textures_) {
            if (entry.texture.id != 0) {
                glDeleteTextures(1, &entry.texture.id);
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
            for (auto& [_, entry] : svg_textures_) {
                unload_svg(entry.texture);
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

        for (const auto& [_, entry] : svg_textures_) {
            stats.svg_texture_bytes += entry.approx_bytes;
        }
        for (const auto& [_, entry] : image_textures_) {
            stats.image_texture_bytes += entry.approx_bytes;
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
            touch_svg(key);
            return it->second.texture;
        }

        SVGTexture tex = load_svg(path, width, height, apply_theme);
        svg_textures_[key] = SvgCacheEntry{
            .texture = tex,
            .approx_bytes = rgba_texture_bytes(width, height, false),
            .last_used = ++use_tick_,
            .pinned = is_pinned_svg_key(key),
        };
        prune_svg_cache();
        return svg_textures_[key].texture;
    }

    ImageTexture& AssetManager::get_image_texture(const std::string& path) {
        auto it = image_textures_.find(path);
        if (it != image_textures_.end()) {
            touch_image(path);
            return it->second.texture;
        }

        int width, height, channels;
        unsigned char* image_data = stbi_load(path.c_str(), &width, &height, &channels, 4); // Force RGBA

        ImageTexture tex = { 0, 0, 0 };

        if (image_data == nullptr) {
			std::cout << "Failed to load image: " << path << std::endl;
            image_textures_[path] = ImageCacheEntry{
                .texture = tex,
                .approx_bytes = 0,
                .last_used = ++use_tick_,
                .pinned = is_pinned_image_key(path),
            };
            return image_textures_[path].texture;
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

        image_textures_[path] = ImageCacheEntry{
            .texture = tex,
            .approx_bytes = rgba_texture_bytes(width, height, true),
            .last_used = ++use_tick_,
            .pinned = is_pinned_image_key(path),
        };
        prune_image_cache();
        return image_textures_[path].texture;
    }

    void AssetManager::touch_svg(const std::string& key) {
        auto it = svg_textures_.find(key);
        if (it != svg_textures_.end()) {
            it->second.last_used = ++use_tick_;
        }
    }

    void AssetManager::touch_image(const std::string& key) {
        auto it = image_textures_.find(key);
        if (it != image_textures_.end()) {
            it->second.last_used = ++use_tick_;
        }
    }

    void AssetManager::prune_svg_cache() {
        while (svg_textures_.size() > kMaxSvgTextures) {
            auto evict_it = svg_textures_.end();
            for (auto it = svg_textures_.begin(); it != svg_textures_.end(); ++it) {
                if (it->second.pinned) {
                    continue;
                }
                if (evict_it == svg_textures_.end() ||
                    it->second.last_used < evict_it->second.last_used) {
                    evict_it = it;
                }
            }
            if (evict_it == svg_textures_.end()) {
                return;
            }
            unload_svg(evict_it->second.texture);
            svg_textures_.erase(evict_it);
        }
    }

    void AssetManager::prune_image_cache() {
        auto current_bytes = [this]() {
            std::size_t total = 0;
            for (const auto& [_, entry] : image_textures_) {
                total += entry.approx_bytes;
            }
            return total;
        };

        std::size_t total_bytes = current_bytes();
        while (total_bytes > kMaxImageBytes) {
            auto evict_it = image_textures_.end();
            for (auto it = image_textures_.begin(); it != image_textures_.end(); ++it) {
                if (it->second.pinned) {
                    continue;
                }
                if (evict_it == image_textures_.end() ||
                    it->second.last_used < evict_it->second.last_used) {
                    evict_it = it;
                }
            }
            if (evict_it == image_textures_.end()) {
                return;
            }
            total_bytes -= evict_it->second.approx_bytes;
            if (evict_it->second.texture.id != 0) {
                glDeleteTextures(1, &evict_it->second.texture.id);
            }
            image_textures_.erase(evict_it);
        }
    }

}
