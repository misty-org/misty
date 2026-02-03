#pragma once

#include <thread>
#include <atomic>
#include <memory>
#include "core/ui_registry.h"

namespace misty::core {

    class FileSyncService {
    public:
        explicit FileSyncService(UIRegistry& registry);
        ~FileSyncService();

        void start();
        void stop();

    private:
        void update_loop();

        UIRegistry& registry_;
        std::atomic<bool> running_{false};
        std::thread worker_thread_;
    };

} // namespace misty::core
