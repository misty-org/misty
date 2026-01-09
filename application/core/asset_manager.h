#pragma once
#include <string>
#include <unordered_map>
#include <memory>
#include "svg_loader.h"


namespace minidfs {

    class AssetManager {
    public:
        // Singleton Access
        static AssetManager& get();

        // Load a CSS theme file into memory
        void load_theme(const std::string& path);

        // Get an icon (Loads and caches if not found)
        SVGTexture& get_icon(const std::string& name, int size = 24);

        // In AssetManager.h
        const std::string& get_current_theme() const;

        // Cleanup GPU resources
        void shutdown();

    private:
        AssetManager() = default;
        ~AssetManager() = default;

        std::string current_theme_;
        std::unordered_map<std::string, SVGTexture> icon_map_;
    };
}