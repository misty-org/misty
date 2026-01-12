#pragma once
#include <vector>
#include <memory>
#include "panel.h"

namespace minidfs {
    enum class ViewID {
        Auth,
        FileExplorer,
        Settings,
        None
    };


    class AppView {
    public:
        AppView() = default;
        ~AppView() = default;

        virtual ViewID get_view_id() = 0;

        virtual void render() = 0;

    protected:
        ViewID view_id;
    };
}