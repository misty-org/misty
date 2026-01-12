#pragma once

#include <vector>
#include <string>
#include <stack>
#include "panel.h"
#include <unordered_set>
#include "ui_registry.h"
#include "minidfs_client.h"

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

        // Update state with new files and path
        void update_files(const std::string& new_path, std::vector<minidfs::FileInfo>&& new_files, bool update_history = true) {
            if (update_history) {
                // Save current path to back history if it's different
                std::string current_path_str(current_path);
                if (!current_path_str.empty() && current_path_str != new_path) {
                    back_history.push(current_path_str);
                }

                // Clear forward history when navigating to new path
                while (!forward_history.empty()) {
                    forward_history.pop();
                }
            }

            // Update files and path
            files = std::move(new_files);
            strncpy(current_path, new_path.c_str(), sizeof(current_path) - 1);
            current_path[sizeof(current_path) - 1] = '\0';

            // Reset UI state
            is_loading = false;
            selected_files.clear();
            last_selected_index = -1;
            error_msg = "";
        }

        // Navigate back - returns the path to navigate to (empty if can't go back)
        std::string go_back() {
            if (back_history.empty()) return "";

            std::string previous_path = back_history.top();
            back_history.pop();

            // Push current to forward
            std::string current(current_path);
            if (!current.empty()) {
                forward_history.push(current);
            }

            return previous_path;
        }

        // Navigate forward - returns the path to navigate to (empty if can't go forward)
        std::string go_forward() {
            if (forward_history.empty()) return "";

            std::string next_path = forward_history.top();
            forward_history.pop();

            // Push current to back
            std::string current(current_path);
            if (!current.empty()) {
                back_history.push(current);
            }

            return next_path;
        }

        bool can_go_back() const { return !back_history.empty(); }
        bool can_go_forward() const { return !forward_history.empty(); }
    };
}
