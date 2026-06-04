#pragma once

#include <atomic>
#include <chrono>
#include <cstddef>
#include <mutex>
#include <string>
#include <vector>

#include "core/ui/state_registry.h"

namespace misty::panel {

enum class NotificationType {
    INFO,
    SUCCESS,
    ERROR,
};

struct Notification {
    uint64_t id = 0;
    std::string message;
    NotificationType type = NotificationType::INFO;
    std::chrono::system_clock::time_point timestamp{};
    std::chrono::steady_clock::time_point visible_at{};
    std::chrono::steady_clock::time_point expires_at{};
    bool has_expiry = true;
    bool toast_visible = true;
    bool read = false;
    bool show_in_activity = true;
};

class NotificationState : public core::StateEntry {
public:
    static constexpr size_t MAX_VISIBLE = 3;
    static constexpr float DEFAULT_DURATION = 3.0f;
    static constexpr size_t MAX_HISTORY = 200;

    NotificationState();

    uint64_t add_notification(const std::string& message,
                              float duration = DEFAULT_DURATION,
                              NotificationType type = NotificationType::INFO);

    uint64_t add_notification_after(const std::string& message,
                                    float duration,
                                    float delay_seconds,
                                    NotificationType type = NotificationType::INFO);

    uint64_t add_toast(const std::string& message,
                       float duration = DEFAULT_DURATION,
                       NotificationType type = NotificationType::INFO);

    bool update_toast(uint64_t id,
                      const std::string& message,
                      float duration = DEFAULT_DURATION,
                      NotificationType type = NotificationType::INFO);

    bool update_notification(uint64_t id,
                             const std::string& message,
                             float duration = DEFAULT_DURATION,
                             NotificationType type = NotificationType::INFO);

    void dismiss(uint64_t id);

    void update();

    std::vector<Notification> get_notifications();

    std::vector<Notification> get_history();

    size_t count();

    size_t unread_count() const;

    void mark_all_read();

    void clear_history();

private:
    Notification make_notification(uint64_t id,
                                   const std::string& message,
                                   float duration,
                                   float delay_seconds,
                                   NotificationType type,
                                   bool show_in_activity) const;
    void prune_expired_locked(std::chrono::steady_clock::time_point now);
    void trim_history_locked();

    mutable std::mutex mu_;
    std::vector<Notification> notifications_;
    std::atomic<uint64_t> next_id_{1};
    std::atomic<size_t> unread_count_{0};
};

}  // namespace misty::panel
