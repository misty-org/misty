#pragma once

#include <chrono>
#include <cstddef>
#include <mutex>
#include <string>

#include "core/ui/state_registry.h"

namespace misty::panel {

inline constexpr const char* kClipboardTransferStateKey = "ClipboardTransfer";

enum class ClipboardTransferStatus {
    Idle,
    Running,
    Succeeded,
    Failed,
};

struct ClipboardTransferSnapshot {
    bool visible = false;
    ClipboardTransferStatus status = ClipboardTransferStatus::Idle;
    std::string title;
    std::string detail;
    std::string current_item;
    std::size_t completed_items = 0;
    std::size_t total_items = 0;
    float progress = 0.0f;
};

class ClipboardTransferState : public core::StateEntry {
public:
    void begin(std::string title, std::string detail, std::size_t total_items);
    void update(std::string detail, std::string current_item, std::size_t completed_items);
    void finish(bool success, std::string detail);
    void dismiss();
    void tick();
    ClipboardTransferSnapshot snapshot() const;

private:
    mutable std::mutex mu_;
    bool visible_ = false;
    ClipboardTransferStatus status_ = ClipboardTransferStatus::Idle;
    std::string title_;
    std::string detail_;
    std::string current_item_;
    std::size_t completed_items_ = 0;
    std::size_t total_items_ = 0;
    std::chrono::steady_clock::time_point finished_at_{};
};

}  // namespace misty::panel
