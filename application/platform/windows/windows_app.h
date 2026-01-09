#pragma once

#define GLFW_EXPOSE_NATIVE_WIN32

#include <windows.h>
#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <GLFW/glfw3native.h>
#include <dwmapi.h>
#include <windowsx.h>


#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include "application.h"

namespace minidfs {
    class WindowsApp : public Application {
    public:
        WindowsApp() = default;
        ~WindowsApp() = default;

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
        static LRESULT CALLBACK win32_window_proc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
    
    private:
        GLFWwindow* window_ = nullptr;
        const char* glsl_version_ = "#version 130";
        static inline WNDPROC wnd_proc_;
        HWND hwnd_ = nullptr;
    };
}
