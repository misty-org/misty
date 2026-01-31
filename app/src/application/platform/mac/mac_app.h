#ifdef __APPLE__
#pragma once

#define GLFW_EXPOSE_NATIVE_COCOA

#include "application.h"
#include "minidfs.h"
#include "imgui.h"
#include <GLFW/glfw3.h>
#include <GLFW/glfw3native.h>

// Objective-C types are hidden behind a private PImpl to
// keep this header consumable from pure C++ translation units.

namespace minidfs {
    struct MacAppObjC; // Forward-declared ObjC-backed state (defined in mac_app.mm)
    class MacApp : public Application {
    public:
        MacApp() = default;
        ~MacApp() = default;

        void init_platform() override;

        void prepare_frame() override;
        void render_frame() override;
        bool is_running() override;
        void cleanup() override;

    private:
        void init_glfw();
        void init_window();
        void init_opengl();
        void init_win32();
    private:
        void setup_window_icon();
        void setup_window_theme();
    private:
        void init_imgui();
        void configure_imgui_io();
        void configure_imgui_style();

    private:
        static void glfw_error_callback(int error, const char* description);
        static void glfw_window_size_callback(GLFWwindow* window, int width, int height);

    private:
        GLFWwindow* window_ = nullptr;
    
        const char* glsl_version_ = "#version 150";
    };
}
#endif

