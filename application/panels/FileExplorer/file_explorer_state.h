#pragma once

#include <vector>
#include <string>
#include "panel.h"
#include <unordered_set>
#include "ui_registry.h"
#include "minidfs_client.h"

namespace minidfs::FileExplorer {
    struct FileExplorerState : public UIState {
        char current_path[512];
        std::vector<minidfs::FileInfo> files;
        std::unordered_set<std::string> selected_files;
        int last_selected_index = -1;
        bool is_loading = false;
        bool is_hidden = false;
        std::string error_msg = "";
        
        std::mutex mu;


        void update_files(const std::string& path, std::vector<minidfs::FileInfo>&& new_files) {

            snprintf(current_path, sizeof(current_path), "%s", path.c_str());

            files = std::move(new_files);

            is_loading = false;
            selected_files.clear();
            last_selected_index = -1;
            error_msg = "";
        }

    };
}
