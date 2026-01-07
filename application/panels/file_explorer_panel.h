#pragma once

#include <memory>
#include "imgui.h"
#include "registry.h"
#include "layer.h"
#include "worker_pool.h"
#include "minidfs_client.h"

namespace minidfs {
   struct FileExplorerState : public UIState {
        char current_path[512];
        std::vector<minidfs::FileInfo> files;
		std::unordered_set<std::string> selected_files;
        int last_selected_index = -1;
        bool is_loading = false;
        std::string error_msg = "";


        void update_files(const std::string& new_query, std::vector<minidfs::FileInfo>&& new_files) {
            std::string normalized = std::filesystem::path(new_query).lexically_normal().generic_string();
            snprintf(current_path, sizeof(current_path), "%s", normalized.c_str());

            files = std::move(new_files);

            is_loading = false;
            selected_files.clear();
            last_selected_index = -1;
            error_msg = "";
        }

   };

    class FileExplorerPanel : public Layer {
    public:
        FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        ~FileExplorerPanel() override = default;
        void render() override;

    private:
        void show_search_bar();
        void show_directory_contents();
    private:
        void get_files(const std::string& query);
    private:
        UIRegistry& registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;
    };
};
