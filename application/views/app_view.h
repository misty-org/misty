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
        AppView(ViewID view_id);
        ~AppView() = default;

        ViewID get_view_id() const;

        void render();

    protected:
        
        void add_layer(std::shared_ptr<Panel> layer);
        void remove_layer(std::shared_ptr<Panel> layer);
    
    protected:
        std::vector<std::shared_ptr<Panel>> panels_;
        ViewID view_id;
    };
}