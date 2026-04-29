#define GLFW_INCLUDE_NONE

#include <filesystem>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

#include "core/commands/command_manager.h"
#include "core/plugins/plugin_host.h"
#include "core/plugins/plugin_signing.h"

namespace fs = std::filesystem;

namespace {

void glfw_error_callback(int error, const char* description) {
    std::fprintf(stderr, "GLFW Error %d: %s\n", error, description);
}

void configure_imgui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    ImGui::StyleColorsDark();
}

bool has_flag(int argc, char** argv, const char* flag) {
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == flag) {
            return true;
        }
    }
    return false;
}

std::string get_arg_value(int argc, char** argv, const char* flag) {
    for (int i = 1; i + 1 < argc; ++i) {
        if (std::string(argv[i]) == flag) {
            return argv[i + 1];
        }
    }
    return {};
}

} // namespace

int main(int argc, char** argv) {
    const bool sign_plugin = has_flag(argc, argv, "--sign-plugin");
    const bool verify_plugin = has_flag(argc, argv, "--verify-plugin");
    const std::string plugin_dir = get_arg_value(argc, argv, "--plugin-dir");
    if (sign_plugin) {
        const std::string private_key = get_arg_value(argc, argv, "--private-key");
        const std::string signer = get_arg_value(argc, argv, "--signer");
        if (plugin_dir.empty() || private_key.empty()) {
            std::cerr << "Usage: misty-plugin-sandbox --sign-plugin --plugin-dir <dir> --private-key <pem> [--signer <id>]\n";
            return 1;
        }

        std::string error;
        if (!misty::core::sign_plugin_manifest(fs::path(plugin_dir),
                                               fs::path(private_key),
                                               signer,
                                               &error)) {
            std::cerr << (error.empty() ? "Failed to sign plugin manifest.\n" : error + "\n");
            return 1;
        }

        std::cout << "Signed " << plugin_dir << "/manifest.json\n";
        return 0;
    }
    if (verify_plugin) {
        if (plugin_dir.empty()) {
            std::cerr << "Usage: misty-plugin-sandbox --verify-plugin --plugin-dir <dir>\n";
            return 1;
        }

        auto& host = misty::core::PluginHost::get();
        const bool loaded = host.load_plugin_directory(fs::path(plugin_dir), false);
        std::cout << "requires_signed=" << (misty::core::plugin_requires_signature() ? "true" : "false") << '\n';
        for (const auto& plugin : host.loaded_plugins()) {
            std::cout << plugin.id << " loaded=" << (plugin.loaded ? "true" : "false")
                      << " verified=" << (plugin.verified ? "true" : "false");
            if (!plugin.signer.empty()) {
                std::cout << " signer=" << plugin.signer;
            }
            std::cout << '\n';
            for (const auto& diagnostic : plugin.diagnostics) {
                std::cout << " - " << diagnostic << '\n';
            }
        }
        host.shutdown();
        return loaded ? 0 : 1;
    }

    glfwSetErrorCallback(glfw_error_callback);
    if (!glfwInit()) {
        std::cerr << "Failed to initialize GLFW\n";
        return 1;
    }

#if defined(__APPLE__)
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
    const char* glsl_version = "#version 150";
#else
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    const char* glsl_version = "#version 130";
#endif

    GLFWwindow* window = glfwCreateWindow(1280, 800, "Misty Plugin Sandbox", nullptr, nullptr);
    if (!window) {
        std::cerr << "Failed to create sandbox window\n";
        glfwTerminate();
        return 1;
    }

    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);
    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
        std::cerr << "Failed to initialize GLAD\n";
        glfwDestroyWindow(window);
        glfwTerminate();
        return 1;
    }

    configure_imgui();
    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init(glsl_version);

    auto& host = misty::core::PluginHost::get();
    if (!plugin_dir.empty()) {
        host.load_plugin_directory(fs::path(plugin_dir), false);
    } else {
        host.discover_and_load();
    }
    misty::core::CommandManager::get().load();

    const auto loaded = host.loaded_plugins();
    for (const auto& plugin : loaded) {
        for (const auto& panel : plugin.panels) {
            host.open_panel(panel.id);
        }
    }

    while (!glfwWindowShouldClose(window)) {
        glfwPollEvents();

        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        host.process_shortcuts();

        ImGui::SetNextWindowPos(ImVec2(20.0f, 20.0f), ImGuiCond_Once);
        ImGui::SetNextWindowSize(ImVec2(420.0f, 760.0f), ImGuiCond_Once);
        if (ImGui::Begin("Sandbox Control")) {
            ImGui::Text("Misty Plugin Sandbox");
            ImGui::Separator();
            if (!plugin_dir.empty()) {
                ImGui::TextWrapped("Loaded plugin directory: %s", plugin_dir.c_str());
            } else {
                ImGui::TextWrapped("Loaded bundled and user plugins.");
            }
            ImGui::Spacing();

            for (const auto& plugin : host.loaded_plugins()) {
                ImGui::PushID(plugin.id.c_str());
                ImGui::Text("%s", plugin.name.c_str());
                ImGui::TextDisabled("%s", plugin.id.c_str());
                if (!plugin.description.empty()) {
                    ImGui::TextWrapped("%s", plugin.description.c_str());
                }
                for (const auto& command : plugin.commands) {
                    if (ImGui::Button(command.title.c_str())) {
                        host.invoke_command(command.id);
                    }
                    if (!command.default_shortcut.empty()) {
                        ImGui::SameLine();
                        ImGui::TextDisabled("%s", command.default_shortcut.c_str());
                    }
                }
                for (const auto& panel : plugin.panels) {
                    const std::string label = (panel.is_open ? "Focus " : "Open ") + panel.title;
                    if (ImGui::Button(label.c_str())) {
                        host.open_panel(panel.id);
                    }
                }
                for (const auto& diagnostic : plugin.diagnostics) {
                    ImGui::BulletText("%s", diagnostic.c_str());
                }
                ImGui::Separator();
                ImGui::PopID();
            }
        }
        ImGui::End();

        host.render_open_panels();

        ImGui::Render();
        int display_w = 0;
        int display_h = 0;
        glfwGetFramebufferSize(window, &display_w, &display_h);
        glViewport(0, 0, display_w, display_h);
        glClearColor(0.07f, 0.07f, 0.08f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        glfwSwapBuffers(window);
    }

    host.shutdown();
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
