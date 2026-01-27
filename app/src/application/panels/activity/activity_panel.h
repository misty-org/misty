#pragma once

#include "core/ui_registry.h"
#include "panels/panel.h"
#include "download_state.h"

namespace minidfs::panel {

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
        void render_filter_tabs();
        void render_download_list();
        void render_download_item(const DownloadItem& item);
        void render_empty_state();

        std::string format_file_size(int64_t bytes);
        std::string format_time_ago(std::chrono::steady_clock::time_point time);

        core::UIRegistry& registry_;
        ActivityFilter current_filter_ = ActivityFilter::ALL;
    };

}
