#pragma once

#include <memory>
#include <mutex>
#include "imgui.h"
#include "ui_registry.h"
#include "panel.h"
#include "worker_pool.h"
#include "file_explorer_state.h"
#include "minidfs_client.h"
#include "svg_loader.h"

namespace minidfs::FileExplorer {
    class FileExplorerPanel : public Panel {
    public:
        FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        ~FileExplorerPanel() override = default;
        void render() override;

    private:
        void show_nav_history(FileExplorerState& state, float button_width, float spacing);
        void show_search_bar(FileExplorerState& state);
        void show_directory_contents(FileExplorerState& state);
        void show_file_item(FileExplorerState& state, int i);
        void show_error_modal(FileExplorerState& state);
    private:
        void get_files(const std::string& path, bool update_history = true);
        void navigate_back();
        void navigate_forward();
        void create_file(const std::string& filename);
        void upload_file(const std::string& source_path);
        void open_file(const std::string& path);
    private:
        UIRegistry& registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;

    };
};
