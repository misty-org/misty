#pragma once

#ifdef __linux__

#include "application.h"
#include <GLFW/glfw3.h>

namespace minidfs {

class LinuxApp : public Application {
public:
    LinuxApp() = default;
    ~LinuxApp() = default;

    void init_platform() override;

    void prepare_frame() override;
    void render_frame() override;
    bool is_running() override;
    void cleanup() override;

private:
    void init_glfw();
    void init_window();
    void init_opengl();
    void init_x11(); // Linux equivalent of init_win32 / ObjC setup

private:
    void setup_window_icon();
    void setup_window_theme(); // no-op on Linux (kept for symmetry)

private:
    void init_imgui();
    void configure_imgui_io();
    void configure_imgui_style();

private:
    static void glfw_error_callback(int error, const char* description);
    static void glfw_window_size_callback(GLFWwindow* window, int width, int height);

private:
    GLFWwindow* window_ = nullptr;
    const char* glsl_version_ = "#version 330";
};

} // namespace minidfs

#endif // __linux__
