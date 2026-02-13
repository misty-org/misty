#pragma once

#include "panels/panel.h"

#include "core/ui_registry.h"
#include "core/worker_pool.h"
#include <functional>

#include "file_sidebar_state.h"

#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/services_state.h"


namespace misty::panel {
    class FileSidebarPanel : public Panel {
    public:
        FileSidebarPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool, std::shared_ptr<MistyClient> client);
        void render();

        void set_mount_path_provider(std::function<std::string()> provider) {
            mount_path_provider_ = provider;
        }

    private:
        void show_services_section(ServicesState& services_state, float width, float padding);
        void show_mounts_section(float width, float padding);
        void show_create_new(FileSidebarState& state, float width, float padding);
        void show_chooser_modal(FileSidebarState& state);
        void show_create_entry_modal(FileSidebarState& state);
        void show_uploader_modal(FileSidebarState& state);
        void show_upload_progress_modal(FileSidebarState& state);
        void start_next_upload(FileSidebarState& state, ServicesState& services_state, OneDriveState& onedrive_state);
        void show_quick_access(float width, float padding);
        void show_storage_info(float width, float padding);
        
    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;
        std::function<std::string()> mount_path_provider_;
    };

}

