#include "app_view.h"

namespace minidfs {
    AppView::AppView(ViewID view_id) : view_id(view_id) {}

    void AppView::add_layer(std::shared_ptr<Panel> layer) {
        panels_.push_back(layer);
    }

    void AppView::remove_layer(std::shared_ptr<Panel> layer) {
        panels_.erase(std::remove(panels_.begin(), panels_.end(), layer), panels_.end());
    }

    ViewID AppView::get_view_id() const {
        return view_id;
    }

    void AppView::render() {
        for (const auto& panel : panels_) {
            panel->render();
        }
    }
}