#define MISTY_PLUGIN_BUILD 1

#include "core/extensions/misty_plugin_sdk.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include "stb_image.h"

namespace {

constexpr const char* kPanelId = "preview-manager.panel";
constexpr std::size_t kMaxSelectedPath = 4096;

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

bool str_iequal(const char* a, const char* b) {
    for (; *a && *b; ++a, ++b) {
        if (std::tolower(static_cast<unsigned char>(*a)) !=
            std::tolower(static_cast<unsigned char>(*b)))
            return false;
    }
    return *a == *b;
}

enum class FileFormat { Unknown, Image, Pdf };

FileFormat detect_format(const char* path) {
    const char* dot = std::strrchr(path, '.');
    if (!dot) return FileFormat::Unknown;

    const char* ext = dot + 1;
    if (str_iequal(ext, "png") || str_iequal(ext, "jpg") ||
        str_iequal(ext, "jpeg") || str_iequal(ext, "bmp") ||
        str_iequal(ext, "gif") || str_iequal(ext, "psd") ||
        str_iequal(ext, "tga") || str_iequal(ext, "hdr") ||
        str_iequal(ext, "pic") || str_iequal(ext, "pnm") ||
        str_iequal(ext, "pgm") || str_iequal(ext, "ppm"))
        return FileFormat::Image;

    if (str_iequal(ext, "pdf"))
        return FileFormat::Pdf;

    return FileFormat::Unknown;
}

const char* filename_from_path(const char* path) {
    const char* slash = std::strrchr(path, '/');
#ifdef _WIN32
    const char* bslash = std::strrchr(path, '\\');
    if (bslash && (!slash || bslash > slash)) slash = bslash;
#endif
    return slash ? slash + 1 : path;
}

// ---------------------------------------------------------------------------
// Preview state
// ---------------------------------------------------------------------------

struct PreviewState {
    misty::Texture texture;

    char file_path[512] = {};
    FileFormat format = FileFormat::Unknown;
    float zoom = 1.0f;
    bool fit_to_width = true;

    int current_page = 0;
    int total_pages = 0;
};

PreviewState g_state;

void reset_preview_state() {
    g_state.texture.destroy();
    g_state.file_path[0] = '\0';
    g_state.format = FileFormat::Unknown;
    g_state.zoom = 1.0f;
    g_state.fit_to_width = true;
    g_state.current_page = 0;
    g_state.total_pages = 0;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

bool load_image(misty::Host& host, const char* path) {
    int w = 0, h = 0, channels = 0;
    unsigned char* pixels = stbi_load(path, &w, &h, &channels, 4);
    if (!pixels) return false;

    g_state.texture = misty::Texture(host, w, h, pixels);
    g_state.current_page = 0;
    g_state.total_pages = 0;

    stbi_image_free(pixels);
    return g_state.texture.valid();
}

bool load_file(misty::Host& host, const char* path) {
    FileFormat fmt = detect_format(path);
    if (fmt == FileFormat::Unknown) return false;

    std::strncpy(g_state.file_path, path, sizeof(g_state.file_path) - 1);
    g_state.file_path[sizeof(g_state.file_path) - 1] = '\0';
    g_state.format = fmt;
    g_state.zoom = 1.0f;
    g_state.fit_to_width = true;

    switch (fmt) {
        case FileFormat::Image:
            return load_image(host, path);
        case FileFormat::Pdf:
            return false;
        default:
            return false;
    }
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

void open_preview(misty::Host& host, void*) {
    if (!host.invoke_command("explorer.preview.toggle")) {
        host.notify_error("Preview", "Preview is only available in the Files view.");
        return;
    }
}

void zoom_preview_in(misty::Host& host, void*) {
    if (!host.invoke_command("explorer.preview.zoom_in")) {
        host.notify_error("Preview", "Preview is only available in the Files view.");
    }
}

void zoom_preview_out(misty::Host& host, void*) {
    if (!host.invoke_command("explorer.preview.zoom_out")) {
        host.notify_error("Preview", "Preview is only available in the Files view.");
    }
}

void reset_preview_zoom(misty::Host& host, void*) {
    if (!host.invoke_command("explorer.preview.zoom_reset")) {
        host.notify_error("Preview", "Preview is only available in the Files view.");
    }
}

void render_preview(misty::Host& host, misty::UI& ui, void*) {
    (void)host;

    if (!g_state.texture) {
        ui.text("No preview loaded.");
        ui.spacing();
        ui.text_wrapped(
            "Select a file in the file explorer and press Ctrl+] to preview.");
        ui.spacing();
        ui.text("Supported formats:");
        ui.text("  Images: PNG, JPG, BMP, GIF, PSD, TGA, HDR");
        ui.text("  Documents: PDF (requires MuPDF)");
        return;
    }

    // --- Toolbar ---
    const char* name = filename_from_path(g_state.file_path);
    ui.text(name);
    ui.same_line();

    char info[128];
    std::snprintf(info, sizeof(info), "  %dx%d",
                  g_state.texture.width(), g_state.texture.height());
    ui.text(info);

    if (ui.button(" - ##zoom_out", 28.0f)) {
        g_state.fit_to_width = false;
        g_state.zoom = std::max(0.1f, g_state.zoom - 0.1f);
    }
    ui.same_line();

    char zoom_label[32];
    std::snprintf(zoom_label, sizeof(zoom_label), "%d%%",
                  static_cast<int>(g_state.zoom * 100));
    ui.text(zoom_label);
    ui.same_line();

    if (ui.button(" + ##zoom_in", 28.0f)) {
        g_state.fit_to_width = false;
        g_state.zoom = std::min(10.0f, g_state.zoom + 0.1f);
    }
    ui.same_line();

    if (ui.button("Fit##zoom_fit", 40.0f)) {
        g_state.fit_to_width = true;
    }

    if (g_state.total_pages > 1) {
        ui.same_line();
        ui.separator();
        ui.same_line();

        if (ui.button("<##page_prev", 28.0f) && g_state.current_page > 0) {
            g_state.current_page--;
        }
        ui.same_line();

        char page_label[64];
        std::snprintf(page_label, sizeof(page_label), "Page %d / %d",
                      g_state.current_page + 1, g_state.total_pages);
        ui.text(page_label);
        ui.same_line();

        if (ui.button(">##page_next", 28.0f) &&
            g_state.current_page < g_state.total_pages - 1) {
            g_state.current_page++;
        }
    }

    ui.separator();

    // --- Image display ---
    float avail_w = 0, avail_h = 0;
    ui.get_content_region_avail(&avail_w, &avail_h);

    if (g_state.fit_to_width && avail_w > 0 && g_state.texture.width() > 0) {
        g_state.zoom =
            avail_w / static_cast<float>(g_state.texture.width());
    }

    float display_w = g_state.texture.width() * g_state.zoom;
    float display_h = g_state.texture.height() * g_state.zoom;

    ui.begin_child("##preview_canvas");
    ui.image(g_state.texture.id(), display_w, display_h);
    ui.end_child();
}

} // namespace

extern "C" std::uint32_t misty_plugin_abi_version() {
    return MISTY_PLUGIN_ABI_VERSION;
}

extern "C" int misty_plugin_register(misty::Registry& registry) {
    misty::CommandRegistration command;
    command.id = "preview-manager.open";
    command.title = "Preview File";
    command.default_shortcut = "Primary+]";
    command.invoke = &open_preview;
    if (!registry.register_command(command)) {
        return 0;
    }

    command = {};
    command.id = "preview-manager.zoom-in";
    command.title = "Zoom Preview In";
    command.default_shortcut = "Primary+Shift+Equal";
    command.invoke = &zoom_preview_in;
    if (!registry.register_command(command)) {
        return 0;
    }

    command = {};
    command.id = "preview-manager.zoom-out";
    command.title = "Zoom Preview Out";
    command.default_shortcut = "Primary+Minus";
    command.invoke = &zoom_preview_out;
    if (!registry.register_command(command)) {
        return 0;
    }

    command = {};
    command.id = "preview-manager.zoom-reset";
    command.title = "Reset Preview Zoom";
    command.default_shortcut = "Primary+0";
    command.invoke = &reset_preview_zoom;
    if (!registry.register_command(command)) {
        return 0;
    }

    misty::PanelRegistration panel;
    panel.id = kPanelId;
    panel.title = "Preview";
    panel.default_open = false;
    panel.render = &render_preview;
    return registry.register_panel(panel) ? 1 : 0;
}
