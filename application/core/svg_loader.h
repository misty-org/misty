#pragma once
#include <string>
#include <imgui.h>

namespace minidfs {
    struct SVGTexture {
        ImTextureID id;
        int width, height;
    };

    // Only the declaration here. No GLAD needed!
    SVGTexture load_svg(const std::string& path, int width, int height);
	void unload_svg(SVGTexture& texture);
}