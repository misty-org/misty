#pragma once

#include <cstddef>
#include <cstdint>

#if defined(_WIN32)
#  if defined(MISTY_PLUGIN_BUILD)
#    define MISTY_PLUGIN_EXPORT __declspec(dllexport)
#  else
#    define MISTY_PLUGIN_EXPORT
#  endif
#else
#  define MISTY_PLUGIN_EXPORT __attribute__((visibility("default")))
#endif

#define MISTY_PLUGIN_ABI_VERSION 2u

namespace misty {

enum class NotificationLevel {
    Info,
    Success,
    Error,
};

// ---------------------------------------------------------------------------
// Host services exposed to plugins.
// ---------------------------------------------------------------------------
class Host {
public:
    virtual ~Host() = default;

    virtual bool open_panel(const char* id) = 0;
    virtual bool close_panel(const char* id) = 0;
    virtual bool is_panel_open(const char* id) = 0;
    virtual bool invoke_command(const char* id) = 0;
    virtual bool copy_current_view_id(char* buffer, std::size_t size) = 0;
    virtual void notify(NotificationLevel level,
                        const char* title,
                        const char* message) = 0;

    virtual std::uint32_t create_texture(int width, int height,
                                         const unsigned char* rgba_pixels) = 0;
    virtual void destroy_texture(std::uint32_t texture_id) = 0;
    virtual bool copy_selected_file_path(char* buffer, std::size_t size) = 0;

    // Convenience (not virtual — plain inlines over the virtual surface).
    void notify_info(const char* title, const char* message) {
        notify(NotificationLevel::Info, title, message);
    }
    void notify_success(const char* title, const char* message) {
        notify(NotificationLevel::Success, title, message);
    }
    void notify_error(const char* title, const char* message) {
        notify(NotificationLevel::Error, title, message);
    }
};

// ---------------------------------------------------------------------------
// ImGui-style drawing surface exposed to panel render callbacks.
// ---------------------------------------------------------------------------
class UI {
public:
    virtual ~UI() = default;

    virtual void text(const char* t) = 0;
    virtual void text_wrapped(const char* t) = 0;
    virtual bool button(const char* label, float width = 0, float height = 0) = 0;
    virtual void same_line() = 0;
    virtual void separator() = 0;
    virtual void spacing() = 0;

    virtual void image(std::uint32_t texture_id, float width, float height) = 0;
    virtual void get_content_region_avail(float* width, float* height) = 0;
    virtual bool begin_child(const char* id, float width = 0, float height = 0,
                             bool border = false) = 0;
    virtual void end_child() = 0;
};

// ---------------------------------------------------------------------------
// Registration types.
// ---------------------------------------------------------------------------
using CommandInvokeFn = void (*)(Host& host, void* user_data);
using PanelRenderFn = void (*)(Host& host, UI& ui, void* user_data);

struct CommandRegistration {
    const char* id = nullptr;
    const char* title = nullptr;
    const char* default_shortcut = nullptr;
    CommandInvokeFn invoke = nullptr;
    void* user_data = nullptr;
};

struct PanelRegistration {
    const char* id = nullptr;
    const char* title = nullptr;
    bool default_open = false;
    PanelRenderFn render = nullptr;
    void* user_data = nullptr;
};

class Registry {
public:
    virtual ~Registry() = default;
    virtual bool register_command(const CommandRegistration& command) = 0;
    virtual bool register_panel(const PanelRegistration& panel) = 0;
};

// ---------------------------------------------------------------------------
// RAII GPU texture handle.
// ---------------------------------------------------------------------------
class Texture {
public:
    Texture() = default;
    Texture(Host& host, int width, int height, const unsigned char* rgba_pixels)
        : host_(&host),
          id_(host.create_texture(width, height, rgba_pixels)),
          width_(width),
          height_(height) {}

    ~Texture() { destroy(); }

    Texture(const Texture&) = delete;
    Texture& operator=(const Texture&) = delete;

    Texture(Texture&& other) noexcept
        : host_(other.host_),
          id_(other.id_),
          width_(other.width_),
          height_(other.height_) {
        other.id_ = 0;
    }

    Texture& operator=(Texture&& other) noexcept {
        if (this != &other) {
            destroy();
            host_ = other.host_;
            id_ = other.id_;
            width_ = other.width_;
            height_ = other.height_;
            other.id_ = 0;
        }
        return *this;
    }

    void destroy() {
        if (id_ != 0 && host_) {
            host_->destroy_texture(id_);
            id_ = 0;
        }
    }

    std::uint32_t id() const { return id_; }
    int width() const { return width_; }
    int height() const { return height_; }
    bool valid() const { return id_ != 0; }
    explicit operator bool() const { return valid(); }

private:
    Host* host_ = nullptr;
    std::uint32_t id_ = 0;
    int width_ = 0;
    int height_ = 0;
};

} // namespace misty

// ---------------------------------------------------------------------------
// Plugin-exported entry points.
// Every plugin must define these two. `extern "C"` only suppresses name
// mangling; the C++ reference parameters still use the host's vtable layout,
// which requires the plugin to be built with an ABI-compatible C++ toolchain.
// ---------------------------------------------------------------------------
extern "C" {
    MISTY_PLUGIN_EXPORT std::uint32_t misty_plugin_abi_version();
    MISTY_PLUGIN_EXPORT int misty_plugin_register(misty::Registry& registry);
}

namespace misty {
    using PluginAbiVersionFn = std::uint32_t (*)();
    using PluginRegisterFn = int (*)(Registry&);
}
