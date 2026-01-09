#pragma once

#include <string>
#include <functional>
#include <unordered_map>
#include <mutex>
#include <memory>
#include "app_view.h"


namespace minidfs {
    class AppViewRegistry {
    public:
        void register_view(ViewID id, std::unique_ptr<AppView> view) {
            views_[id] = std::move(view);
        }

        void switch_view(ViewID id) {
            if (views_.find(id) != views_.end()) {
                current_view_ = views_[id].get();
            }
        }

        void render_view() {
            if (current_view_) {
                current_view_->render();
            }
        }

        ViewID get_current_id() const {
            return current_view_ ? current_view_->get_view_id() : ViewID::None;
        }

    private:
        std::unordered_map<ViewID, std::unique_ptr<AppView>> views_;
        AppView* current_view_ = nullptr;
    };

    class AppViewRegistryController {
    public:
        static void init(AppViewRegistry* registry) {
            s_registry = registry;
        }
        static void switch_view(ViewID id) {
            std::lock_guard<std::mutex> lock(s_mutex);
            if (s_registry) {
                s_registry->switch_view(id);
            }
        }
    private:
        inline static AppViewRegistry* s_registry = nullptr;
        inline static std::mutex s_mutex;
    };
};
