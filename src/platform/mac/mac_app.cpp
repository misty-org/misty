#ifdef __APPLE__
#define GLFW_INCLUDE_NONE
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#include "mac_app.h"
#include "core/manager/asset_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/font_manager.h"
#include "core/manager/theme_manager.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include <cstdio>
#include <filesystem>

namespace misty {
    std::pair<int, int> MacApp::window_size() const {
        if (!window_) {
            return {0, 0};
        }
        int w = 0;
        int h = 0;
        glfwGetWindowSize(window_, &w, &h);
        return {w, h};
    }

    void MacApp::set_window_size(int width, int height) {
        if (!window_ || width <= 0 || height <= 0) {
            return;
        }
        glfwSetWindowSize(window_, width, height);
    }

    void MacApp::center_window() {
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

    void MacApp::init_platform() {
        init_glfw();
        init_window();
        init_opengl();
		setup_window_icon();
		init_imgui();
    }

    void MacApp::cleanup() {
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplGlfw_Shutdown();
        ImGui::DestroyContext();
        glfwDestroyWindow(window_);
        glfwTerminate();
    }
    void MacApp::init_glfw() {
        glfwSetErrorCallback(glfw_error_callback);
        if (!glfwInit()) throw std::runtime_error("Failed to initialize GLFW");
        glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
        glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
        glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
    }

    void MacApp::init_window() {
        window_ = glfwCreateWindow(1280, 720, "Misty", NULL, NULL);
        if (!window_) throw std::runtime_error("Failed to create GLFW window");
        glfwSetWindowSizeLimits(
            window_,
            kPlatformMinWindowWidth,
            kPlatformMinWindowHeight,
            GLFW_DONT_CARE,
            GLFW_DONT_CARE
        );
        glfwMakeContextCurrent(window_); //VERY IMPORTANT
        glfwSetWindowUserPointer(window_, this);
        frame_pacer().set_wake_callback([]() { glfwPostEmptyEvent(); });
        glfwSetWindowSizeCallback(window_, glfw_window_size_callback);
        glfwSetWindowPosCallback(window_, glfw_window_pos_callback);
        glfwSetWindowCloseCallback(window_, glfw_window_close_callback);
        glfwSetWindowRefreshCallback(window_, glfw_window_refresh_callback);
        glfwSetWindowFocusCallback(window_, glfw_window_focus_callback);
        glfwSetCursorPosCallback(window_, glfw_cursor_pos_callback);
        glfwSetMouseButtonCallback(window_, glfw_mouse_button_callback);
        glfwSetKeyCallback(window_, glfw_key_callback);
        glfwSetCharCallback(window_, glfw_char_callback);
    }

    void MacApp::init_opengl() {
        if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
            throw std::runtime_error("Failed to initialize GLAD");
        }
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    }

    void MacApp::setup_window_icon() {
        GLFWimage images[1]; 
        
        int channels;
        const std::filesystem::path icon_path =
            core::AssetManager::get().resolve_asset_path("assets/logo/mist_v1");
        images[0].pixels = stbi_load(icon_path.string().c_str(), &images[0].width, &images[0].height, &channels, 4);

        if (images[0].pixels) {
            glfwSetWindowIcon(window_, 1, images);
            stbi_image_free(images[0].pixels); // Free memory after passing to GLFW
        }
    }

    void MacApp::init_imgui() {
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();

        configure_imgui_io();
        configure_imgui_style();

        core::AssetManager::get().load_themes();
        ImGui_ImplGlfw_InitForOpenGL(window_, true);
        ImGui_ImplOpenGL3_Init(glsl_version_);
        core::FontManager::get().load_fonts();
        glfwSetScrollCallback(window_, glfw_scroll_callback);
    }


    void MacApp::configure_imgui_io() {
        ImGuiIO& io = ImGui::GetIO();
        io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;     // Enable Keyboard Controls
        io.ConfigFlags |= ImGuiConfigFlags_NavEnableGamepad;      // Enable Gamepad Controls
        io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;         // Enable Docking
        io.ConfigFlags |= ImGuiConfigFlags_ViewportsEnable;       // Enable multi-viewport windows

        // Experimental DPI features (GLFW 3.3+)
        if (GLFW_VERSION_MAJOR >= 3 && GLFW_VERSION_MINOR >= 3) {
            io.ConfigDpiScaleFonts = true;
        }

        static std::string ini_path;
        if (ini_path.empty()) {
            const std::string home = core::EnvManager::get().get_user_home_dir();
            if (!home.empty()) {
                namespace fs = std::filesystem;
                const fs::path path = fs::path(home) / ".misty" / "config" / "imgui.ini";
                std::error_code ec;
                fs::create_directories(path.parent_path(), ec);
                ini_path = path.string();
            }
        }
        if (!ini_path.empty()) {
            io.IniFilename = ini_path.c_str();
        }
     
    }

    void MacApp::configure_imgui_style() {
        core::ThemeManager::get().initialize_from_settings();
        core::ThemeManager::get().apply_current_style(ImGui::GetStyle());
	}

    void MacApp::prepare_frame() {
        const core::FramePacer::WaitDecision wait_decision = frame_pacer().next_wait_decision();
        if (wait_decision.should_wait) {
            glfwWaitEventsTimeout(wait_decision.timeout_seconds);
        } else {
            glfwPollEvents();
        }

        bool pointer_button_down = false;
        for (int button = GLFW_MOUSE_BUTTON_1; button <= GLFW_MOUSE_BUTTON_LAST; ++button) {
            if (glfwGetMouseButton(window_, button) == GLFW_PRESS) {
                pointer_button_down = true;
                break;
            }
        }
        bool item_active = false;
        if (ImGui::GetCurrentContext()) {
            item_active = ImGui::IsAnyItemActive();
        }
        frame_pacer().note_continuous_activity(pointer_button_down, item_active);

        int display_w, display_h;
        glfwGetFramebufferSize(window_, &display_w, &display_h);
        glViewport(0, 0, display_w, display_h);
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();
    }

    void MacApp::render_frame() {
        ImGui::Render();
        
        int w, h;
        glfwGetFramebufferSize(window_, &w, &h);
        if (w == 0 || h == 0)
            return;

        glfwMakeContextCurrent(window_);
        glViewport(0, 0, w, h);
        const ImVec4 clear = core::ThemeManager::get().clear_color();
        glClearColor(clear.x, clear.y, clear.z, clear.w);
        glClear(GL_COLOR_BUFFER_BIT);

        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        if (ImGui::GetIO().ConfigFlags & ImGuiConfigFlags_ViewportsEnable) {
            GLFWwindow* backup_context = glfwGetCurrentContext();
            ImGui::UpdatePlatformWindows();
            ImGui::RenderPlatformWindowsDefault();
            glfwMakeContextCurrent(backup_context);
        }

        glfwSwapBuffers(window_);
    }

    bool MacApp::is_running() {
        return !glfwWindowShouldClose(window_);
    }

    void MacApp::glfw_error_callback(int error, const char* description) {
        fprintf(stderr, "GLFW Error %d: %s\n", error, description);
    }

    void MacApp::glfw_window_size_callback(GLFWwindow*, int, int) {
        core::FramePacer::request_immediate_frame();
    }

    void MacApp::glfw_window_pos_callback(GLFWwindow*, int, int) {
        core::FramePacer::request_immediate_frame();
    }

    void MacApp::glfw_window_close_callback(GLFWwindow* window) {
        static_cast<Application*>(glfwGetWindowUserPointer(window))->persist_file_explorer_state();
    }

    void MacApp::glfw_window_refresh_callback(GLFWwindow*) {
        core::FramePacer::request_immediate_frame();
    }

    void MacApp::glfw_window_focus_callback(GLFWwindow* window, int focused) {
        auto* app = static_cast<Application*>(glfwGetWindowUserPointer(window));
        if (focused) {
            app->frame_pacer().note_focus();
        } else {
            app->on_focus_lost();
        }
    }

    void MacApp::glfw_cursor_pos_callback(GLFWwindow* window, double, double) {
        static_cast<Application*>(glfwGetWindowUserPointer(window))->frame_pacer().note_cursor_move();
    }

    void MacApp::glfw_mouse_button_callback(GLFWwindow* window, int, int action, int) {
        if (action == GLFW_PRESS || action == GLFW_REPEAT || action == GLFW_RELEASE) {
            static_cast<Application*>(glfwGetWindowUserPointer(window))->frame_pacer().note_pointer_press();
        }
    }

    void MacApp::glfw_key_callback(GLFWwindow* window, int, int, int action, int) {
        if (action == GLFW_PRESS || action == GLFW_REPEAT) {
            static_cast<Application*>(glfwGetWindowUserPointer(window))->frame_pacer().note_key_press();
        }
    }

    void MacApp::glfw_char_callback(GLFWwindow* window, unsigned int) {
        static_cast<Application*>(glfwGetWindowUserPointer(window))->frame_pacer().note_text_input();
    }

    void MacApp::glfw_scroll_callback(GLFWwindow* window, double xoffset, double yoffset) {
        static_cast<Application*>(glfwGetWindowUserPointer(window))->frame_pacer().note_scroll();
        constexpr double kScrollWheelScale = 0.10;
        ImGui_ImplGlfw_ScrollCallback(window, xoffset * kScrollWheelScale, yoffset * kScrollWheelScale);
    }
}
#endif
