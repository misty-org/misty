#ifdef __linux__

#define GLFW_INCLUDE_NONE
#define STB_IMAGE_IMPLEMENTATION

#include "linux_app.h"
#include "core/manager/asset_manager.h"
#include "core/manager/env_manager.h"
#include "stb_image.h"

#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

#include <glad/glad.h>
#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <filesystem>

namespace misty {

std::pair<int, int> LinuxApp::window_size() const {
    if (!window_) {
        return {0, 0};
    }
    int w = 0;
    int h = 0;
    glfwGetWindowSize(window_, &w, &h);
    return {w, h};
}

void LinuxApp::set_window_size(int width, int height) {
    if (!window_ || width <= 0 || height <= 0) {
        return;
    }
    glfwSetWindowSize(window_, width, height);
}

void LinuxApp::center_window() {
    if (!window_) {
        return;
    }
    GLFWmonitor* monitor = glfwGetPrimaryMonitor();
    if (!monitor) {
        return;
    }
    int win_w = 0;
    int win_h = 0;
    glfwGetWindowSize(window_, &win_w, &win_h);
    int mx = 0;
    int my = 0;
    int mw = 0;
    int mh = 0;
    glfwGetMonitorWorkarea(monitor, &mx, &my, &mw, &mh);
    const int x = mx + std::max(0, (mw - win_w) / 2);
    const int y = my + std::max(0, (mh - win_h) / 2);
    glfwSetWindowPos(window_, x, y);
}

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
    window_ = glfwCreateWindow(1280, 720, "Misty", nullptr, nullptr);
    if (!window_)
        throw std::runtime_error("Failed to create GLFW window");

    glfwMakeContextCurrent(window_);
    glfwSetWindowUserPointer(window_, this);
    glfwSetWindowSizeCallback(window_, glfw_window_size_callback);
    glfwSetWindowFocusCallback(window_, glfw_window_focus_callback);

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

    core::AssetManager::get().load_themes();
    core::AssetManager::get().load_fonts();

    ImGui_ImplGlfw_InitForOpenGL(window_, true);
    ImGui_ImplOpenGL3_Init(glsl_version_);
    glfwSetScrollCallback(window_, glfw_scroll_callback);
}

void LinuxApp::configure_imgui_io() {
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableGamepad;
    io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;

#if GLFW_VERSION_MAJOR >= 3 && GLFW_VERSION_MINOR >= 3
    io.ConfigDpiScaleFonts = true;
#endif

    static std::string ini_path;
    if (ini_path.empty()) {
        const std::string home = core::EnvManager::get().get_user_home_dir();
        if (!home.empty()) {
            namespace fs = std::filesystem;
            const fs::path path = fs::path(home) / "misty" / "config" / "imgui.ini";
            std::error_code ec;
            fs::create_directories(path.parent_path(), ec);
            ini_path = path.string();
        }
    }
    if (!ini_path.empty()) {
        io.IniFilename = ini_path.c_str();
    }
}

void LinuxApp::configure_imgui_style() {
    ImGui::StyleColorsDark();

    ImGuiStyle& style = ImGui::GetStyle();
    style.FrameRounding    = 8.0f;
    style.GrabRounding     = 8.0f;
    style.ScrollbarRounding = 6.0f;
    style.WindowRounding   = 0.0f;
    style.PopupRounding    = 0.0f;
    style.ScrollbarSize    = 12.0f;
    style.ScrollbarPadding = 0.0f;

    style.Colors[ImGuiCol_Text]                 = ImVec4(0.831f, 0.831f, 0.847f, 1.0f);
    style.Colors[ImGuiCol_TextDisabled]         = ImVec4(0.443f, 0.443f, 0.478f, 1.0f);
    style.Colors[ImGuiCol_WindowBg]             = ImVec4(0.067f, 0.067f, 0.075f, 1.0f);
    style.Colors[ImGuiCol_PopupBg]              = ImVec4(0.067f, 0.067f, 0.075f, 1.0f);
    style.Colors[ImGuiCol_Border]               = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_FrameBg]              = ImVec4(0.094f, 0.094f, 0.106f, 1.0f);
    style.Colors[ImGuiCol_FrameBgHovered]       = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_FrameBgActive]        = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_TitleBg]              = ImVec4(0.035f, 0.035f, 0.043f, 1.0f);
    style.Colors[ImGuiCol_TitleBgActive]        = ImVec4(0.094f, 0.094f, 0.106f, 1.0f);
    style.Colors[ImGuiCol_MenuBarBg]            = ImVec4(0.067f, 0.067f, 0.075f, 1.0f);
    style.Colors[ImGuiCol_ScrollbarBg]          = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    style.Colors[ImGuiCol_ScrollbarGrab]        = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_ScrollbarGrabHovered] = ImVec4(0.22f, 0.22f, 0.24f, 1.0f);
    style.Colors[ImGuiCol_ScrollbarGrabActive]  = ImVec4(0.443f, 0.443f, 0.478f, 1.0f);
    style.Colors[ImGuiCol_CheckMark]            = ImVec4(0.231f, 0.510f, 0.965f, 1.0f);
    style.Colors[ImGuiCol_SliderGrab]           = ImVec4(0.231f, 0.510f, 0.965f, 1.0f);
    style.Colors[ImGuiCol_SliderGrabActive]     = ImVec4(0.145f, 0.388f, 0.922f, 1.0f);
    style.Colors[ImGuiCol_Button]               = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_ButtonHovered]        = ImVec4(0.22f, 0.22f, 0.24f, 1.0f);
    style.Colors[ImGuiCol_ButtonActive]         = ImVec4(0.10f, 0.10f, 0.11f, 1.0f);
    style.Colors[ImGuiCol_Header]               = ImVec4(0.094f, 0.094f, 0.106f, 1.0f);
    style.Colors[ImGuiCol_HeaderHovered]        = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_HeaderActive]         = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_Separator]            = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_Tab]                  = ImVec4(0.094f, 0.094f, 0.106f, 1.0f);
    style.Colors[ImGuiCol_TabHovered]           = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_TabSelected]          = ImVec4(0.153f, 0.153f, 0.165f, 1.0f);
    style.Colors[ImGuiCol_NavHighlight]         = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
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

void LinuxApp::glfw_window_focus_callback(GLFWwindow* window, int focused) {
    if (!focused)
        static_cast<Application*>(glfwGetWindowUserPointer(window))->on_focus_lost();
}

void LinuxApp::glfw_scroll_callback(GLFWwindow* window, double xoffset, double yoffset) {
    constexpr double kScrollWheelScale = 0.10;
    ImGui_ImplGlfw_ScrollCallback(window, xoffset * kScrollWheelScale, yoffset * kScrollWheelScale);
}

} // namespace misty

#endif // __linux__
