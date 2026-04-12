#pragma once

#include <string>
#include "imgui.h"

namespace misty::panel {
    class Panel {
    public:
        virtual ~Panel() = default;
        virtual void render() = 0;
        
    protected:
        void show_error_modal(std::string& error_msg, const char* modal_id = "Error");
 
    };
};