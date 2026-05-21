#include "app_view.h"
#include "core/system/frame_pacer.h"
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <mutex>

namespace misty::view {
    namespace {
        void append_view_log(const std::string& line) {
            const char* home = std::getenv("HOME");
            if (!home || *home == '\0') return;
            namespace fs = std::filesystem;
            const fs::path path = fs::path(home) / ".misty" / ".cache" / "misty-view.log";
            std::error_code ec;
            fs::create_directories(path.parent_path(), ec);
            std::ofstream f(path, std::ios::app);
            if (!f.is_open()) return;
            f << line << "\n";
        }

        const char* view_name(ViewID id) {
            switch (id) {
                case ViewID::Auth: return "Auth";
                case ViewID::Login: return "Login";
                case ViewID::Files: return "Files";
                case ViewID::Settings: return "Settings";
                case ViewID::Workspace: return "Workspace";
                case ViewID::Activity: return "Activity";
                case ViewID::Providers: return "Providers";
                case ViewID::Extensions: return "Extensions";
                case ViewID::Vault: return "Vault";
                case ViewID::Transfers: return "Transfers";
                case ViewID::Default: return "Default";
            }
            return "Unknown";
        }
    }

    bool ViewRegistry::apply_view_locked(ViewID id) {
        ensure_view_locked(id);
        auto it = views_.find(id);
        if (it != views_.end()) {
            append_view_log(std::string("apply_view: ") + view_name(id));
            current_view_id_ = id;
            current_view_ = it->second.get();
            return true;
        }
        return false;
    }

    void ViewRegistry::restore_fallback_view_locked() {
        if (current_view_ != nullptr) {
            return;
        }

        if (apply_view_locked(ViewID::Files)) {
            append_view_log("fallback_view: Files");
            return;
        }

        if (!views_.empty()) {
            current_view_id_ = views_.begin()->first;
            current_view_ = views_.begin()->second.get();
            append_view_log(std::string("fallback_view: ") + view_name(current_view_id_));
        }
    }

    // ViewRegistry implementation
    void ViewRegistry::init_default_view() {
        // Default view initialization - no-op since AppView is abstract
        // The default view will be set when a view is registered and switched to
    }

    bool ViewRegistry::ensure_view_locked(ViewID id) {
        if (views_.find(id) != views_.end()) {
            return true;
        }
        const auto factory_it = view_factories_.find(id);
        if (factory_it == view_factories_.end() || !factory_it->second) {
            return false;
        }
        views_[id] = factory_it->second();
        append_view_log(std::string("instantiate_view: ") + view_name(id));
        return views_[id] != nullptr;
    }

    void ViewRegistry::register_view(ViewID id, std::unique_ptr<AppView> view) {
        std::lock_guard<std::mutex> lock(mutex_);
        views_[id] = std::move(view);
    }

    void ViewRegistry::register_view_factory(ViewID id, std::function<std::unique_ptr<AppView>()> factory) {
        std::lock_guard<std::mutex> lock(mutex_);
        view_factories_[id] = std::move(factory);
    }

    void ViewRegistry::switch_view(ViewID id) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (current_view_ != nullptr && current_view_id_ == id && !has_pending_view_) {
            append_view_log(std::string("ignored_view_same: ") + view_name(id));
            return;
        }
        if (ensure_view_locked(id)) {
            append_view_log(std::string("request_view: ") + view_name(id) +
                            (is_rendering_ ? " (deferred)" : " (immediate)"));
            if (is_rendering_) {
                pending_view_id_ = id;
                has_pending_view_ = true;
            } else {
                apply_view_locked(id);
            }
            core::FramePacer::request_immediate_frame();
        } else {
            append_view_log(std::string("ignored_view: ") + view_name(id));
        }
        // If view not registered, keep current view to avoid rendering nothing
    }

    void ViewRegistry::render_current_view() {
        // Get current view pointer before releasing lock to avoid issues
        // if switch_view is called from within render()
        AppView* view_to_render = nullptr;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (has_pending_view_) {
                apply_view_locked(pending_view_id_);
                has_pending_view_ = false;
            }
            restore_fallback_view_locked();
            view_to_render = current_view_;
            is_rendering_ = true;
        }
        
        // Render without holding the lock to avoid deadlocks
        if (view_to_render) {
            append_view_log(std::string("render_view: ") + view_name(view_to_render->get_view_id()));
            view_to_render->render();
        }

        {
            std::lock_guard<std::mutex> lock(mutex_);
            is_rendering_ = false;
            if (has_pending_view_) {
                apply_view_locked(pending_view_id_);
                has_pending_view_ = false;
            }
        }
    }

    ViewID ViewRegistry::get_current_view_id() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return current_view_id_;
    }

    AppView* ViewRegistry::get_current_view() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return current_view_;
    }

    AppView* ViewRegistry::get_view(ViewID id) const {
        std::lock_guard<std::mutex> lock(mutex_);
        const_cast<ViewRegistry*>(this)->ensure_view_locked(id);
        auto it = views_.find(id);
        return it == views_.end() ? nullptr : it->second.get();
    }

    bool ViewRegistry::get_view_capabilities(ViewID id, ViewCapabilities* out) const {
        if (!out) {
            return false;
        }
        std::lock_guard<std::mutex> lock(mutex_);
        const_cast<ViewRegistry*>(this)->ensure_view_locked(id);
        auto it = views_.find(id);
        if (it == views_.end() || !it->second) {
            *out = {};
            return false;
        }
        *out = it->second->capabilities();
        return true;
    }

    PluginOpenResult ViewRegistry::open_plugin_in_view(ViewID id,
                                                       const std::string& panel_id,
                                                       PluginOpenMode mode) {
        AppView* target_view = nullptr;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            ensure_view_locked(id);
            auto it = views_.find(id);
            if (it == views_.end() || !it->second) {
                return PluginOpenResult::Failed;
            }
            target_view = it->second.get();
        }
        return target_view->open_plugin_panel(panel_id, mode);
    }

    std::size_t ViewRegistry::loaded_view_count() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return views_.size();
    }

    void ViewRegistry::clear() {
        std::unordered_map<ViewID, std::unique_ptr<AppView>> views;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            current_view_ = nullptr;
            current_view_id_ = ViewID::Default;
            pending_view_id_ = ViewID::Default;
            has_pending_view_ = false;
            is_rendering_ = false;
            views.swap(views_);
            view_factories_.clear();
        }
    }

    ViewRegistry& ViewRegistry::get() {
        static ViewRegistry instance;
        return instance;
    }

    // Public API functions
    void register_view(ViewID id, std::unique_ptr<AppView> view) {
        ViewRegistry::get().register_view(id, std::move(view));
    }

    void register_view_factory(ViewID id, std::function<std::unique_ptr<AppView>()> factory) {
        ViewRegistry::get().register_view_factory(id, std::move(factory));
    }

    void switch_view(ViewID id) {
        ViewRegistry::get().switch_view(id);
    }

    void render_current_view() {
        ViewRegistry::get().render_current_view();
    }

    ViewID get_current_view_id() {
        return ViewRegistry::get().get_current_view_id();
    }

    bool get_view_capabilities(ViewID id, ViewCapabilities* out) {
        return ViewRegistry::get().get_view_capabilities(id, out);
    }

    PluginOpenResult open_plugin_in_view(ViewID id, const std::string& panel_id, PluginOpenMode mode) {
        return ViewRegistry::get().open_plugin_in_view(id, panel_id, mode);
    }

    std::size_t loaded_view_count() {
        return ViewRegistry::get().loaded_view_count();
    }

    void clear_views() {
        ViewRegistry::get().clear();
    }

    void debug_log_view_event(const std::string& line) {
        append_view_log(line);
    }
}
