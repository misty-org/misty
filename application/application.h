#pragma once
#include <GLFW/glfw3.h>
#include <vector>
#include <memory>
#include <functional>
#include <string>
#include "imgui.h"
#include "panel.h"
#include "ui_registry.h"
#include "app_view_registry.h"
#include "file_explorer_panel.h"
#include "tool_menu_panel.h"
#include "navbar_panel.h"
#include "worker_pool.h"
#include "minidfs_client.h"
#include "app_view.h"
#include "file_explorer_view.h"


namespace minidfs {
    class Application {
    public:
		Application() = default;
        ~Application() = default;

        void run();
        void init_client();
        void init_views();

    protected:
        // Pure virtual functions (the "Interface")
        virtual void init_platform() = 0;
        virtual void prepare_frame() = 0;
        virtual void render_frame() = 0;
        virtual bool is_running() = 0;
        virtual void cleanup() = 0;

    protected:
        UIRegistry ui_registry_;
        AppViewRegistry app_view_registry_;

        WorkerPool worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;

    };  
};
