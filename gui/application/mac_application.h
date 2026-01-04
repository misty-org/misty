#pragma once

#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_metal.h"
#include <stdio.h>

#define GLFW_INCLUDE_NONE
#define GLFW_EXPOSE_NATIVE_COCOA
#include <GLFW/glfw3.h>
#include <GLFW/glfw3native.h>

#include <stdexcept>


class MacApplication {
public:
    MacApplication();
    ~MacApplication();
    void run();

private:
    int init();                  // initialize GLFW, ImGui, Metal
    void update(float dt);       // application logic
    void render();               // rendering + ImGui
    void draw_gui();            // ImGui widgets

    GLFWwindow* window_;
    id<MTLDevice> device_;
    id<MTLCommandQueue> commandQueue_;
    CAMetalLayer* layer_;
    MTLRenderPassDescriptor* renderPassDescriptor_;

    bool show_demo_window_ = true;
    bool show_another_window_ = false;
    float clear_color_[4] = {0.45f, 0.55f, 0.60f, 1.0f};

    float counter_ = 0.0f;        // example of logic state
};
