#pragma once

#include <vector>
#include <string>
#include <stack>
#include <unordered_set>
#include <mutex>
#include <filesystem>
#include <cstring>
#include "ui_registry.h"
#include "minidfs.pb.h"

namespace fs = std::filesystem;

namespace minidfs::FileExplorer {
    struct FileExplorerState : public UIState {
        char current_path[512] = "";
        std::vector<minidfs::FileInfo> files;
        std::unordered_set<std::string> selected_files;
        int last_selected_index = -1;
        bool is_loading = false;
        bool is_hidden = false;
        std::string error_msg = "";
        std::stack<std::string> back_history;
        std::stack<std::string> forward_history;
        std::mutex mu;

    };

    

    inline void get_files(FileExplorerState& state, std::string path, bool update_history = true) {
        state.is_loading = true;
        std::string new_path = fs::absolute(fs::path(path)).generic_string();
        try {
            std::vector<minidfs::FileInfo> new_files;
            for (const auto& entry : fs::directory_iterator(path)) {
                minidfs::FileInfo file_info;
                file_info.set_file_path(entry.path().generic_string());
                file_info.set_is_dir(entry.is_directory());
                new_files.push_back(file_info);
            }
            if (update_history) {
                // Save current path to back history if it's different
                std::string current_path_str(state.current_path);
                if (!current_path_str.empty() && current_path_str != new_path) {
                    state.back_history.push(current_path_str);
                }

                // Clear forward history when navigating to new path
                while (!state.forward_history.empty()) {
                    state.forward_history.pop();
                }
            }

            // Update files and path
            state.files = std::move(new_files);
            strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
            state.current_path[sizeof(state.current_path) - 1] = '\0';

            // Reset UI state
            state.is_loading = false;
            state.selected_files.clear();
            state.last_selected_index = -1;
            state.error_msg = "";
        }
        catch (const std::exception& e) {
            state.error_msg = e.what();
            state.is_loading = false;
        }
    }

    // Navigate back - returns the path to navigate to (empty if can't go back)
    inline void go_back(FileExplorerState& state) {
        if (state.back_history.empty()) return;

        std::string previous_path = state.back_history.top();
        state.back_history.pop();

        // Push current to forward
        std::string current(state.current_path);
        if (!current.empty()) {
            state.forward_history.push(current);
        }

        if (!previous_path.empty()) {
            get_files(state, previous_path, false);
        }
    }

    // Navigate forward - returns the path to navigate to (empty if can't go forward)
    inline void go_forward(FileExplorerState& state) {
        if (state.forward_history.empty()) return;

        std::string next_path = state.forward_history.top();
        state.forward_history.pop();

        // Push current to back
        std::string current(state.current_path);
        if (!current.empty()) {
            state.back_history.push(current);
        }

        if (!next_path.empty()) {
            get_files(state, next_path, false);
        }
    }

    inline bool can_go_back(FileExplorerState& state) { return !state.back_history.empty(); }
    inline bool can_go_forward(FileExplorerState& state) { return !state.forward_history.empty(); }

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>

    inline void open_file(const std::string& path) {
        ShellExecuteA(NULL, "open", path.c_str(), NULL, NULL, SW_SHOWNORMAL);
    }
#elif __APPLE__
    inline void open_file(const std::string& path) {
        std::string cmd = "open \"" + path + "\"";
        system(cmd.c_str());
    }
#elif __linux__
    inline void open_file(const std::string& path) {
        std::string cmd = "xdg-open \"" + path + "\"";
        system(cmd.c_str());
    }
#endif
}
