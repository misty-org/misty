#include "panels/clipboard/clipboard_transfer_state.h"

#include <algorithm>

#include "core/system/frame_pacer.h"

namespace misty::panel {
namespace {

constexpr auto kAutoCloseDelay = std::chrono::milliseconds(1200);

}  // namespace

void ClipboardTransferState::begin(std::string title, std::string detail, std::size_t total_items) {
    std::lock_guard<std::mutex> lock(mu_);
    visible_ = true;
    status_ = ClipboardTransferStatus::Running;
    title_ = std::move(title);
    detail_ = std::move(detail);
    current_item_.clear();
    completed_items_ = 0;
    total_items_ = total_items;
    finished_at_ = {};
    core::FramePacer::request_immediate_frame();
}

void ClipboardTransferState::update(std::string detail,
                                    std::string current_item,
                                    std::size_t completed_items) {
    std::lock_guard<std::mutex> lock(mu_);
    if (status_ != ClipboardTransferStatus::Running) {
        return;
    }
    detail_ = std::move(detail);
    current_item_ = std::move(current_item);
    completed_items_ = total_items_ == 0
        ? completed_items
        : std::min(completed_items, total_items_);
    core::FramePacer::request_immediate_frame();
}

void ClipboardTransferState::finish(bool success, std::string detail) {
    std::lock_guard<std::mutex> lock(mu_);
    visible_ = true;
    status_ = success ? ClipboardTransferStatus::Succeeded : ClipboardTransferStatus::Failed;
    detail_ = std::move(detail);
    if (success && total_items_ > 0) {
        completed_items_ = total_items_;
    }
    finished_at_ = std::chrono::steady_clock::now();
    core::FramePacer::request_immediate_frame();
}

void ClipboardTransferState::dismiss() {
    std::lock_guard<std::mutex> lock(mu_);
    visible_ = false;
    status_ = ClipboardTransferStatus::Idle;
    title_.clear();
    detail_.clear();
    current_item_.clear();
    completed_items_ = 0;
    total_items_ = 0;
    finished_at_ = {};
    core::FramePacer::request_immediate_frame();
}

void ClipboardTransferState::tick() {
    std::lock_guard<std::mutex> lock(mu_);
    if (!visible_ || status_ == ClipboardTransferStatus::Running || finished_at_ == std::chrono::steady_clock::time_point{}) {
        return;
    }
    if (std::chrono::steady_clock::now() - finished_at_ >= kAutoCloseDelay) {
        visible_ = false;
        status_ = ClipboardTransferStatus::Idle;
    }
}

ClipboardTransferSnapshot ClipboardTransferState::snapshot() const {
    std::lock_guard<std::mutex> lock(mu_);
    ClipboardTransferSnapshot out;
    out.visible = visible_;
    out.status = status_;
    out.title = title_;
    out.detail = detail_;
    out.current_item = current_item_;
    out.completed_items = completed_items_;
    out.total_items = total_items_;
    out.progress = total_items_ == 0
        ? 0.0f
        : static_cast<float>(completed_items_) / static_cast<float>(total_items_);
    return out;
}

}  // namespace misty::panel
