#pragma once

#include "imgui.h"
#include <string>

namespace minidfs {
    class Panel {
    public:
        virtual ~Panel() = default;
        virtual void render() = 0;
 
    };
};