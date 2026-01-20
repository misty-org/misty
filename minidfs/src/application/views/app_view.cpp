#include "app_view.h"
#include <mutex>

namespace minidfs::view {

    // ViewRegistry implementation
    void ViewRegistry::register_view(ViewID id, std::unique_ptr<AppView> view) {
        std::lock_guard<std::mutex> lock(mutex_);
        views_[id] = std::move(view);
    }

    void ViewRegistry::switch_view(ViewID id) {
        std::lock_guard<std::mutex> lock(mutex_);
        
        // Set new current view (must have been registered)
        if (views_.find(id) != views_.end()) {
            current_view_id_ = id;
            current_view_ = views_[id].get();
        }
        // If view not registered, keep current view to avoid rendering nothing
    }

    void ViewRegistry::render_current() {
        // Get current view pointer before releasing lock to avoid issues
        // if switch_view is called from within render()
        AppView* view_to_render = nullptr;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            view_to_render = current_view_;
        }
        
        // Render without holding the lock to avoid deadlocks
        if (view_to_render) {
            view_to_render->render();
        }
    }

    ViewID ViewRegistry::get_current_id() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return current_view_id_;
    }

    ViewRegistry& ViewRegistry::get() {
        static ViewRegistry instance;
        return instance;
    }

    // Public API functions
    void register_view(ViewID id, std::unique_ptr<AppView> view) {
        ViewRegistry::get().register_view(id, std::move(view));
    }

    void switch_view(ViewID id) {
        ViewRegistry::get().switch_view(id);
    }

    void render_current_view() {
        ViewRegistry::get().render_current();
    }

    ViewID get_current_view_id() {
        return ViewRegistry::get().get_current_id();
    }
}
