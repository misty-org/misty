#ifdef __linux__

#define GLFW_INCLUDE_NONE

#include "linux_app.h"
#include "core/asset_manager.h"
#include "stb_image.h"

#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

#include <glad/glad.h>
#include <cstdio>
#include <iostream>
#include <stdexcept>

namespace minidfs {

void LinuxApp::init_platform() {
    init_glfw();
    init_window();
    init_opengl();
    init_x11();
    setup_window_icon();
    setup_window_theme();
    init_imgui();
}

void LinuxApp::cleanup() {
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();

    glfwDestroyWindow(window_);
    glfwTerminate();
}

void LinuxApp::init_glfw() {
    glfwSetErrorCallback(glfw_error_callback);

    if (!glfwInit())
        throw std::runtime_error("Failed to initialize GLFW");

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
}

void LinuxApp::init_window() {
    window_ = glfwCreateWindow(1280, 720, "MiniDFS Client", nullptr, nullptr);
    if (!window_)
        throw std::runtime_error("Failed to create GLFW window");

    glfwMakeContextCurrent(window_);
    glfwSetWindowUserPointer(window_, this);
    glfwSetWindowSizeCallback(window_, glfw_window_size_callback);

    glfwSwapInterval(1);
}

void LinuxApp::init_opengl() {
    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress))
        throw std::runtime_error("Failed to initialize GLAD");

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
}

void LinuxApp::init_x11() {
    // Placeholder for:
    // - X11 hints
    // - Wayland-specific tweaks
    // - IME / clipboard setup
    // GLFW handles most of this internally
}

void LinuxApp::setup_window_icon() {
    GLFWimage images[1];
    int channels;

    images[0].pixels = stbi_load(
        "assets/logo/mist_v1",
        &images[0].width,
        &images[0].height,
        &channels,
        4
    );

    if (images[0].pixels) {
        glfwSetWindowIcon(window_, 1, images);
        stbi_image_free(images[0].pixels);
    }
}

void LinuxApp::setup_window_theme() {
    // No standard system dark/light theme API on Linux
    // Kept for interface symmetry
}

void LinuxApp::init_imgui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();

    configure_imgui_io();
    configure_imgui_style();

    AssetManager::get().load_themes();
    AssetManager::get().load_fonts();

    ImGui_ImplGlfw_InitForOpenGL(window_, true);
    ImGui_ImplOpenGL3_Init(glsl_version_);
}

void LinuxApp::configure_imgui_io() {
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableGamepad;
    io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    io.ConfigFlags |= ImGuiConfigFlags_ViewportsEnable;

#if GLFW_VERSION_MAJOR >= 3 && GLFW_VERSION_MINOR >= 3
    io.ConfigDpiScaleFonts = true;
    io.ConfigDpiScaleViewports = true;
#endif
}

void LinuxApp::configure_imgui_style() {
    ImGui::StyleColorsDark();

    ImGuiStyle& style = ImGui::GetStyle();
    style.FrameRounding = 6.0f;
    style.GrabRounding = 6.0f;
    style.ScrollbarRounding = 6.0f;
}

void LinuxApp::prepare_frame() {
    glfwPollEvents();

    int display_w, display_h;
    glfwGetFramebufferSize(window_, &display_w, &display_h);
    glViewport(0, 0, display_w, display_h);

    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGui::NewFrame();
}

void LinuxApp::render_frame() {
    ImGui::Render();

    int w, h;
    glfwGetFramebufferSize(window_, &w, &h);
    if (w == 0 || h == 0)
        return;

    glfwMakeContextCurrent(window_);
    glViewport(0, 0, w, h);
    glClearColor(0.11f, 0.11f, 0.11f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

    ImGuiIO& io = ImGui::GetIO();
    if (io.ConfigFlags & ImGuiConfigFlags_ViewportsEnable) {
        ImGui::UpdatePlatformWindows();
        ImGui::RenderPlatformWindowsDefault();
        glfwMakeContextCurrent(window_);
    }

    glfwSwapBuffers(window_);
}

bool LinuxApp::is_running() {
    return !glfwWindowShouldClose(window_);
}

void LinuxApp::glfw_error_callback(int error, const char* description) {
    fprintf(stderr, "GLFW Error %d: %s\n", error, description);
}

void LinuxApp::glfw_window_size_callback(GLFWwindow*, int, int) {
    // intentionally empty
}

} // namespace minidfs

#endif // __linux__
