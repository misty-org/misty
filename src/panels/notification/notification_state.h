#pragma once

#include <atomic>
#include <cstddef>
#include <string>
#include <vector>

#include "core/ui/state_registry.h"

namespace misty::panel {

enum class NotificationType {
    INFO,
    SUCCESS,
    ERROR,
    DOWNLOAD
};

struct Notification {
    uint64_t id = 0;
    std::string message;
};

class NotificationState : public core::StateEntry {
public:
    static constexpr size_t MAX_VISIBLE = 3;
    static constexpr float DEFAULT_DURATION = 2.5f;

    uint64_t add_notification(const std::string& message,
                              float duration = DEFAULT_DURATION) {
        (void)message;
        (void)duration;
        return next_id_++;
    }

    uint64_t add_notification_after(const std::string& message,
                                    float duration,
                                    float delay_seconds) {
        (void)message;
        (void)duration;
        (void)delay_seconds;
        return next_id_++;
    }

    void dismiss(uint64_t id) {
        (void)id;
    }

    void update() {}

    std::vector<Notification> get_notifications() {
        return {};
    }

    size_t count() {
        return 0;
    }

private:
    std::atomic<uint64_t> next_id_{1};
};

}  // namespace misty::panel
