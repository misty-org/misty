#pragma once

#include "ui_registry.h"
#include <string>

namespace minidfs {
    struct ToolMenuState : public UIState {
        // 1. Context: What directory are we currently acting on?
        std::string current_working_path = "/";

        // 2. Input Buffers: For "New File" or "New Folder" modals
        char name_buffer[256] = "";
        
        // 3. UI Flow Control: Which modal is currently open?
        bool show_new_file_modal = false;
        bool show_new_folder_modal = false;

        // 4. Action Feedback
        bool is_performing_action = false;
        std::string status_message = ""; 
    };
}