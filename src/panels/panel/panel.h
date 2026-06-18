#pragma once

#include <functional>
#include <string>

#include "imgui.h"

namespace misty::panel {
    struct ConfirmModalProps {
        bool* is_open = nullptr;
        const char* modal_id = "Confirm";
        const char* title = "Confirm";
        const char* message = "";
        const char* confirm_label = "Confirm";
        const char* cancel_label = "Cancel";
        bool dangerous = false;
    };

    struct EmptyStateProps {
        const char* title = "";
        const char* message = "";
        const char* action_label = nullptr;
        ImVec2 min_size = ImVec2(0.0f, 120.0f);
    };

    struct LoadingModalProps {
        bool is_open = false;
        const char* modal_id = "Loading";
        const char* title = "Loading";
        const char* message = "Please wait...";
    };

    struct ErrorModalProps {
        bool is_open = false;
        const char* modal_id = "Error";
        const char* title = "Error";
        const char* message = "";
        const char* confirm_label = "OK";
        const char* icon_name = nullptr;
        float icon_size = 32.0f;
        bool dismissible = true;
        std::function<void()> on_confirm;
    };

    bool render_error_modal(const ErrorModalProps& props);
    bool render_confirm_modal(const ConfirmModalProps& props);
    void render_loading_modal(const LoadingModalProps& props);

    class Panel {
    public:
        virtual ~Panel() = default;
        virtual void render() = 0;
        virtual std::string tab_title() const { return {}; }
        virtual std::string save_restore_state() const { return {}; }
        virtual void load_restore_state(const std::string& state) { (void)state; }
        virtual void release_state() {}
        virtual std::string close_warning() const { return {}; }

    protected:
        void show_error_modal(std::string& error_msg, const char* modal_id = "Error");
        bool show_error_modal(const ErrorModalProps& props);
        bool show_confirm_modal(const ConfirmModalProps& props);
        bool show_empty_state(const EmptyStateProps& props);
        void show_loading_modal(const LoadingModalProps& props);

    };
};
