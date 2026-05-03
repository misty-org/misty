#include "transfer_window_state.h"

namespace misty::panel {

void TransferWindowState::open(bool focus) {
    std::lock_guard<std::mutex> lock(mu_);
    is_open_ = true;
    request_focus_ = request_focus_ || focus;
}

void TransferWindowState::close() {
    std::lock_guard<std::mutex> lock(mu_);
    is_open_ = false;
}

void TransferWindowState::toggle(bool focus) {
    std::lock_guard<std::mutex> lock(mu_);
    is_open_ = !is_open_;
    if (is_open_ && focus) {
        request_focus_ = true;
    }
}

void TransferWindowState::focus() {
    std::lock_guard<std::mutex> lock(mu_);
    is_open_ = true;
    request_focus_ = true;
}

void TransferWindowState::reset_layout() {
    std::lock_guard<std::mutex> lock(mu_);
    request_layout_reset_ = true;
    request_focus_ = true;
    is_open_ = true;
}

void TransferWindowState::set_filter(TransferWindowFilter filter) {
    std::lock_guard<std::mutex> lock(mu_);
    filter_ = filter;
}

TransferWindowFilter TransferWindowState::filter() const {
    std::lock_guard<std::mutex> lock(mu_);
    return filter_;
}

void TransferWindowState::set_prefer_external_viewport(bool prefer_external_viewport) {
    std::lock_guard<std::mutex> lock(mu_);
    prefer_external_viewport_ = prefer_external_viewport;
}

bool TransferWindowState::prefer_external_viewport() const {
    std::lock_guard<std::mutex> lock(mu_);
    return prefer_external_viewport_;
}

bool TransferWindowState::is_open() const {
    std::lock_guard<std::mutex> lock(mu_);
    return is_open_;
}

bool TransferWindowState::consume_focus_request() {
    std::lock_guard<std::mutex> lock(mu_);
    bool requested = request_focus_;
    request_focus_ = false;
    return requested;
}

bool TransferWindowState::consume_layout_reset_request() {
    std::lock_guard<std::mutex> lock(mu_);
    bool requested = request_layout_reset_;
    request_layout_reset_ = false;
    return requested;
}

}  // namespace misty::panel
