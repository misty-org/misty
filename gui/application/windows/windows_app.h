#pragma once
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include "application.h"

class WindowsApp : public Application {
public:
    int init() override;

    void prepare_frame() override;
    void render_frame() override;
    bool is_running() override;

    void cleanup() override;

private:
    void setup_imgui_options();
};