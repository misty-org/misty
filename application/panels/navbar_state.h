#pragma once

#include "registry.h"   

namespace minidfs {
    struct NavbarState : public UIState {
        int selected_item = 0; // 0=Home, 1=Folders, 2=Activity, 3=More
    };
}
