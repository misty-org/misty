#pragma once
#include "minidfs.h"

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
