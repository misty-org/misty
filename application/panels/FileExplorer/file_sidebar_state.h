#pragma once

#include "ui_registry.h"
#include <string>

namespace minidfs::FileExplorer {
    struct FileSidebarState : public UIState {
        // 1. Context: What directory are we currently acting on?
        std::string current_working_path = "/";

        // 2. Input Buffers: For "New File" or "New Folder" modals
        char name_buffer[256] = "";
        
        bool show_chooser_modal = false;
        bool show_create_entry_modal = false;
        bool create_is_dir = false;
        
        // 4. Action Feedback
        bool is_performing_action = false;
        std::string status_message = ""; 
    };
}