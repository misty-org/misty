#pragma once

#include <memory>
#include <string>
#include <unordered_map>
#include <mutex>
#include <functional>

namespace misty::view {
    struct ViewCapabilities {
        bool tabs = false;
        bool split = false;
    };

    enum class PluginOpenMode {
        Inline,
        Tab,
        Split,
    };

    enum class PluginOpenResult {
        Opened,
        Unsupported,
        Failed,
    };

    enum class ViewID {
        Files,
        Settings,
        Workspace,
        Activity,
        Providers,
        Plugins,
        Dock,
        Transfers,
        Default
    };

    class AppView {
    public:
        AppView() = default;
        virtual ~AppView() = default;

        virtual ViewID get_view_id() = 0;
        virtual void render() = 0;
        virtual std::string active_explorer_state_key() const { return "Files"; }
        virtual bool invoke_command(const std::string& command_id) { (void)command_id; return false; }
        virtual ViewCapabilities capabilities() const { return {}; }
        virtual PluginOpenResult open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) {
            (void)panel_id;
            (void)mode;
            return PluginOpenResult::Unsupported;
        }

    protected:
        ViewID view_id;
    };

    class ViewRegistry {
        
    public:
        void init_default_view();
        void register_view(ViewID id, std::unique_ptr<AppView> view);
        void register_view_factory(ViewID id, std::function<std::unique_ptr<AppView>()> factory);
        void switch_view(ViewID id);
        void render_current_view();
        ViewID get_current_view_id() const;
        AppView* get_current_view() const;
        AppView* get_view(ViewID id) const;
        bool get_view_capabilities(ViewID id, ViewCapabilities* out) const;
        PluginOpenResult open_plugin_in_view(ViewID id, const std::string& panel_id, PluginOpenMode mode);
        std::size_t loaded_view_count() const;
        void clear();

        static ViewRegistry& get();

    private:
        bool ensure_view_locked(ViewID id);
        bool apply_view_locked(ViewID id);
        void restore_fallback_view_locked();

        std::unordered_map<ViewID, std::unique_ptr<AppView>> views_;
        std::unordered_map<ViewID, std::function<std::unique_ptr<AppView>()>> view_factories_;
        AppView* current_view_ = nullptr;
        ViewID current_view_id_ = ViewID::Default;
        ViewID pending_view_id_ = ViewID::Default;
        bool has_pending_view_ = false;
        bool is_rendering_ = false;
        
        mutable std::mutex mutex_;
    };

    // Public API functions
    void register_view(ViewID id, std::unique_ptr<AppView> view);
    void register_view_factory(ViewID id, std::function<std::unique_ptr<AppView>()> factory);
    void switch_view(ViewID id);
    void render_current_view();
    ViewID get_current_view_id();
    bool get_view_capabilities(ViewID id, ViewCapabilities* out);
    PluginOpenResult open_plugin_in_view(ViewID id, const std::string& panel_id, PluginOpenMode mode);
    std::size_t loaded_view_count();
    void clear_views();
    void debug_log_view_event(const std::string& line);
}
