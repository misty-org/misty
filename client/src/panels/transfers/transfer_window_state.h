#pragma once

#include <mutex>

#include "core/ui/ui_registry.h"

namespace misty::panel {

inline constexpr const char* kTransferWindowStateKey = "TransferWindow";

enum class TransferWindowFilter {
    ACTIVE,
    ALL,
    FAILED,
    COMPLETED,
};

class TransferWindowState : public core::UIState {
public:
    void open(bool focus = true);
    void close();
    void toggle(bool focus = true);
    void focus();
    void reset_layout();

    void set_filter(TransferWindowFilter filter);
    TransferWindowFilter filter() const;

    void set_prefer_external_viewport(bool prefer_external_viewport);
    bool prefer_external_viewport() const;

    bool is_open() const;
    bool consume_focus_request();
    bool consume_layout_reset_request();

private:
    mutable std::mutex mu_;
    bool is_open_ = false;
    bool request_focus_ = false;
    bool request_layout_reset_ = false;
    bool prefer_external_viewport_ = true;
    TransferWindowFilter filter_ = TransferWindowFilter::ACTIVE;
};

}  // namespace misty::panel
