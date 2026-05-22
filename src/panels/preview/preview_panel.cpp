#include "panels/preview/preview_panel.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>

#include <glad/glad.h>

#include "stb_image.h"

namespace fs = std::filesystem;

namespace misty::panel {
namespace {

std::string lower_extension(const std::string& path) {
    std::string ext = fs::path(path).extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return ext;
}

bool is_image_extension(const std::string& ext) {
    return ext == ".png" || ext == ".jpg" || ext == ".jpeg" ||
           ext == ".bmp" || ext == ".gif" || ext == ".psd" ||
           ext == ".tga" || ext == ".hdr" || ext == ".pic" ||
           ext == ".pnm" || ext == ".pgm" || ext == ".ppm";
}

bool is_pdf_extension(const std::string& ext) {
    return ext == ".pdf";
}

std::string shell_quote(const std::string& value) {
    std::string quoted = "'";
    for (char c : value) {
        if (c == '\'') {
            quoted += "'\\''";
        } else {
            quoted += c;
        }
    }
    quoted += "'";
    return quoted;
}

const char* find_mutool() {
    static bool searched = false;
    static const char* cached = nullptr;
    if (searched) {
        return cached;
    }
    searched = true;
    if (std::system("command -v mutool >/dev/null 2>&1") == 0) {
        cached = "mutool";
        return cached;
    }
#ifdef __APPLE__
    if (std::system("test -x /opt/homebrew/bin/mutool") == 0) {
        cached = "/opt/homebrew/bin/mutool";
        return cached;
    }
    if (std::system("test -x /usr/local/bin/mutool") == 0) {
        cached = "/usr/local/bin/mutool";
        return cached;
    }
#endif
    return nullptr;
}

fs::path pdf_preview_path(const std::string& path) {
    std::string key = path;
    std::replace(key.begin(), key.end(), '/', '_');
    std::replace(key.begin(), key.end(), '\\', '_');
    if (key.size() > 96) {
        key = key.substr(key.size() - 96);
    }
    return fs::temp_directory_path() / ("misty-preview-" + key + ".png");
}

}  // namespace

PreviewPanel::~PreviewPanel() {
    clear_texture();
}

bool PreviewPanel::supports(const FileItem& item) const {
    if (item.is_dir || item.path.empty()) {
        return false;
    }
    const std::string ext = lower_extension(item.path);
    return is_image_extension(ext) || is_pdf_extension(ext);
}

bool PreviewPanel::render(const FileItem& item, const ImVec2& size) {
    if (!ensure_loaded(item)) {
        render_message("Preview unavailable", error_message_.empty() ? "This file cannot be previewed." : error_message_.c_str(), size);
        return false;
    }

    if (texture_id_ == 0 || texture_width_ <= 0 || texture_height_ <= 0) {
        render_message("No preview", "This file did not produce a preview image.", size);
        return false;
    }

    const float max_w = std::max(1.0f, size.x);
    const float max_h = std::max(1.0f, size.y);
    const float scale = std::min(max_w / static_cast<float>(texture_width_),
                                 max_h / static_cast<float>(texture_height_));
    const ImVec2 image_size(
        std::max(1.0f, texture_width_ * scale),
        std::max(1.0f, texture_height_ * scale));

    const ImVec2 start = ImGui::GetCursorScreenPos();
    ImGui::Dummy(size);
    const ImVec2 pos(
        start.x + (size.x - image_size.x) * 0.5f,
        start.y + (size.y - image_size.y) * 0.5f);
    ImGui::GetWindowDrawList()->AddImage(
        static_cast<ImTextureID>(static_cast<intptr_t>(texture_id_)),
        pos,
        ImVec2(pos.x + image_size.x, pos.y + image_size.y));
    return true;
}

void PreviewPanel::clear_texture() {
    if (texture_id_ != 0) {
        GLuint texture = static_cast<GLuint>(texture_id_);
        glDeleteTextures(1, &texture);
        texture_id_ = 0;
    }
    texture_width_ = 0;
    texture_height_ = 0;
}

bool PreviewPanel::ensure_loaded(const FileItem& item) {
    if (item.path == loaded_path_ && texture_id_ != 0 && loaded_kind_ != PreviewKind::Error) {
        return true;
    }

    clear_texture();
    loaded_path_ = item.path;
    error_message_.clear();
    loaded_kind_ = PreviewKind::None;

    const std::string ext = lower_extension(item.path);
    if (is_image_extension(ext)) {
        loaded_kind_ = PreviewKind::Image;
        return load_image_file(item.path);
    }
    if (is_pdf_extension(ext)) {
        loaded_kind_ = PreviewKind::Pdf;
        return load_pdf_first_page(item.path);
    }

    loaded_kind_ = PreviewKind::Unsupported;
    error_message_ = "Unsupported preview type.";
    return false;
}

bool PreviewPanel::load_image_file(const std::string& path) {
    int width = 0;
    int height = 0;
    int channels = 0;
    unsigned char* pixels = stbi_load(path.c_str(), &width, &height, &channels, 4);
    if (!pixels || width <= 0 || height <= 0) {
        if (pixels) {
            stbi_image_free(pixels);
        }
        loaded_kind_ = PreviewKind::Error;
        error_message_ = "Could not decode image.";
        return false;
    }

    GLuint texture = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    stbi_image_free(pixels);

    texture_id_ = static_cast<std::uint32_t>(texture);
    texture_width_ = width;
    texture_height_ = height;
    return texture_id_ != 0;
}

bool PreviewPanel::load_pdf_first_page(const std::string& path) {
    const char* mutool = find_mutool();
    if (!mutool) {
        loaded_kind_ = PreviewKind::Error;
        error_message_ = "PDF preview requires mutool.";
        return false;
    }

    const fs::path out = pdf_preview_path(path);
    std::error_code ec;
    fs::create_directories(out.parent_path(), ec);
    const std::string command = std::string(mutool) +
        " draw -o " + shell_quote(out.string()) +
        " -F png -r 140 " + shell_quote(path) + " 1 >/dev/null 2>&1";
    if (std::system(command.c_str()) != 0 || !fs::exists(out, ec)) {
        loaded_kind_ = PreviewKind::Error;
        error_message_ = "Could not render PDF preview.";
        return false;
    }

    return load_image_file(out.string());
}

void PreviewPanel::render_message(const char* title, const char* message, const ImVec2& size) const {
    const ImVec2 start = ImGui::GetCursorScreenPos();
    ImGui::Dummy(size);
    const float title_w = ImGui::CalcTextSize(title).x;
    const float message_w = ImGui::CalcTextSize(message).x;
    const float text_h = ImGui::GetTextLineHeightWithSpacing() * 2.0f;
    ImGui::SetCursorScreenPos(ImVec2(start.x + std::max(0.0f, (size.x - title_w) * 0.5f),
                                     start.y + std::max(0.0f, (size.y - text_h) * 0.5f)));
    ImGui::TextUnformatted(title);
    ImGui::SetCursorScreenPos(ImVec2(start.x + std::max(0.0f, (size.x - message_w) * 0.5f),
                                     ImGui::GetCursorScreenPos().y));
    ImGui::TextDisabled("%s", message);
}

}  // namespace misty::panel
