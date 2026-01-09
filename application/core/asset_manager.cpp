#include "asset_manager.h"
#include <fstream>
#include <sstream>

namespace minidfs {

    void AssetManager::shutdown() {
        for (auto& [name, texture] : icon_map_) {
            unload_svg(texture);
        }
        icon_map_.clear();
    }

    void AssetManager::load_theme(const std::string& path) {
        std::ifstream file(path);
        if (file.is_open()) {
            std::stringstream buffer;
            buffer << file.rdbuf();
            current_theme_ = buffer.str();
            
            // If theme changes, we must clear cache to re-render icons
            icon_map_.clear(); 

            std::cout << "Loaded theme from: " << path << std::endl;
        }
    }

    SVGTexture& AssetManager::get_icon(const std::string& name, int size) {
        std::string key = name + ".svg";

        // 1. Check if it's already in the cache
        auto it = icon_map_.find(key);
        if (it != icon_map_.end()) {
            return it->second;
        }

        // 2. Try to load the requested icon
        std::string path = "assets/icons/" + key;

        std::cout << "Loading icon: " << path << std::endl;
        SVGTexture tex = load_svg(path, size, size);


        // 4. Cache whatever we ended up with (actual icon, fallback, or null)
        icon_map_[key] = tex;
        return icon_map_[key];
    }

    const std::string& AssetManager::get_current_theme() const {
        return current_theme_;
    }
    
    AssetManager& AssetManager::get() {
        static AssetManager instance;
        return instance;
    }

}