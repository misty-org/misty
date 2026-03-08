#pragma once

#include <cstdint>
#include <string>

#include "imgui.h"
#include "panels/file_explorer/state/file_listings_state.h"

namespace misty::panel {

class PreviewPanel {
public:
    PreviewPanel() = default;
    ~PreviewPanel();

    PreviewPanel(const PreviewPanel&) = delete;
    PreviewPanel& operator=(const PreviewPanel&) = delete;

    bool supports(const FileItem& item) const;
    bool render(const FileItem& item, const ImVec2& size);

private:
    enum class PreviewKind {
        None,
        Image,
        Pdf,
        Unsupported,
        Error,
    };

    void clear_texture();
    bool ensure_loaded(const FileItem& item);
    bool load_image_file(const std::string& path);
    bool load_pdf_first_page(const std::string& path);
    void render_message(const char* title, const char* message, const ImVec2& size) const;

    std::string loaded_path_;
    std::string error_message_;
    PreviewKind loaded_kind_ = PreviewKind::None;
    std::uint32_t texture_id_ = 0;
    int texture_width_ = 0;
    int texture_height_ = 0;
};

}  // namespace misty::panel
