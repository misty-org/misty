#pragma once
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"
#include "core/threading/file_sync_service.h"
#include "views/app_view.h"
#include "dfs/client/misty_client.h"


namespace misty {
    class Application {
    public:
		Application() = default;
        virtual ~Application() = default;

        void run();
        void init_client();
        void init_views();
        void on_focus_lost();

    protected:
        // Pure virtual functions (the "Interface")
        virtual void init_platform() = 0;
        virtual void prepare_frame() = 0;
        virtual void render_frame() = 0;
        virtual bool is_running() = 0;
        virtual void cleanup() = 0;

    protected:
        core::UIRegistry ui_registry_;
        core::WorkerPool worker_pool_;
        std::shared_ptr<MistyClient> client_;
        std::unique_ptr<core::FileSyncService> file_sync_service_;

    };  
};
