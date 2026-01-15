#include "svg_loader.h"
#include "asset_manager.h"
#include <glad/glad.h>
#include <lunasvg.h>
#include <iostream>

namespace minidfs::core {
    SVGTexture load_svg(const std::string& path, int width, int height) {
        auto document = lunasvg::Document::loadFromFile(path);
        if (!document) {
            // Log error or return null texture
            return { 0, 0, 0 };
        }

        // Automatically apply the global theme if one is loaded
        std::string css = AssetManager::get().get_current_theme();
		std::cout << "Applying theme CSS to SVG: " << css << std::endl;
        if (!css.empty()) {
            document->applyStyleSheet(css);
        }

        auto bitmap = document->renderToBitmap(width, height);
        bitmap.convertToRGBA();

        GLuint texture_id;
        glGenTextures(1, &texture_id);
        glBindTexture(GL_TEXTURE_2D, texture_id);

        // Pixel store alignment - helps with non-standard icon sizes
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, bitmap.data());

        return { (ImTextureID)(intptr_t)texture_id, width, height };
    }

    void unload_svg(SVGTexture& texture) {
        if (texture.id) {
            GLuint id = (GLuint)(uintptr_t)texture.id;
            glDeleteTextures(1, &id);
            texture.id = 0;
        }
    }
}