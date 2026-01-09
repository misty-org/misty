#pragma once

#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#ifdef _WIN32
#include <glad/glad.h>
#endif
#include "application.h"

namespace minidfs {
    class WindowsApp : public Application {
    public:
        void init_platform() override;

        void prepare_frame() override;
        void render_frame() override;
        bool is_running() override;

        void cleanup() override;

    private:
        static void glfw_error_callback(int error, const char* description);
        static void glfw_window_size_callback(GLFWwindow* window, int width, int height);
        void setup_imgui_options();
    private:
        GLFWwindow* window_ = nullptr;
        const char* glsl_version_ = "#version 130";
        ImVec4 clear_color_ = ImVec4(0.45f, 0.55f, 0.60f, 1.00f);
    };
}
