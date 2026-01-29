#pragma once

#include "core/ui_registry.h"
#include "panels/panel.h"
#include "download_state.h"
#include "upload_state.h"
#include "panels/notification/notification_state.h"

namespace minidfs::panel {

    enum class ActivityCategory {
        NOTIFICATIONS,
        DOWNLOADS,
        UPLOADS
    };

    enum class ActivityFilter {
        ALL,
        ACTIVE,
        COMPLETED,
        FAILED
    };

    class ActivityPanel : public Panel {
    public:
        ActivityPanel(core::UIRegistry& registry);
        ~ActivityPanel() override = default;

        void render() override;

    private:
        void render_header();
        void render_category_tabs();

        // Notifications tab
        void render_notification_list();
        void render_notification_item(const Notification& notif);
        void render_notification_empty();

        // Downloads tab
        void render_download_filter_tabs();
        void render_download_list();
        void render_download_item(const DownloadItem& item);
        void render_download_empty();

        // Uploads tab
        void render_upload_filter_tabs();
        void render_upload_list();
        void render_upload_item(const UploadItem& item);
        void render_upload_empty();

        // Helpers
        std::string format_file_size(int64_t bytes);
        std::string format_time_ago(std::chrono::steady_clock::time_point time);
        ImVec4 get_notification_type_color(NotificationType type);
        const char* get_notification_type_label(NotificationType type);

        core::UIRegistry& registry_;
        ActivityCategory current_category_ = ActivityCategory::NOTIFICATIONS;
        ActivityFilter download_filter_ = ActivityFilter::ALL;
        ActivityFilter upload_filter_ = ActivityFilter::ALL;
    };

}
