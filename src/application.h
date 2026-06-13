#pragma once
#include "core/ui/state_registry.h"
#include "core/system/frame_pacer.h"
#include "core/threading/worker_pool.h"
#include "core/clipboard/clipboard_service.h"
#include "core/clipboard/proxy_clipboard_client.h"
#include "panels/clipboard/clipboard_transfer_panel.h"
#include "panels/errors/errors_panel.h"
#include "views/app_view.h"
#include <memory>
#include <utility>

class MistyClient;

namespace misty {
    inline constexpr int kPlatformMinWindowWidth = 900;
    inline constexpr int kPlatformMinWindowHeight = 600;

    class Application {
    public:
		Application() = default;
        virtual ~Application() = default;

        void run();
        void init_client();
        void init_clipboard();
        void init_views();
        void on_focus_lost();
        void persist_file_explorer_state();
        core::FramePacer& frame_pacer();
        const core::FramePacer& frame_pacer() const;

    protected:
        // Pure virtual functions (the "Interface")
        virtual void init_platform() = 0;
        virtual void prepare_frame() = 0;
        virtual void render_frame() = 0;
        virtual bool is_running() = 0;
        virtual void cleanup() = 0;
        virtual std::pair<int, int> window_size() const = 0;
        virtual void set_window_size(int width, int height) = 0;
        virtual void center_window() = 0;

    protected:
        core::StateRegistry state_registry_;
        core::WorkerPool worker_pool_;
        std::shared_ptr<MistyClient> client_;
        std::unique_ptr<core::ProxyClipboardClient> proxy_clipboard_client_;
        std::unique_ptr<core::ClipboardService> clipboard_service_;
        panel::ClipboardTransferPanel clipboard_transfer_panel_{state_registry_};
        panel::ErrorsPanel errors_panel_;
        core::FramePacer frame_pacer_;

    };  
};
