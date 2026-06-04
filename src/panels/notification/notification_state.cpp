#include "panels/notification/notification_state.h"

#include <algorithm>

namespace misty::panel {

namespace {
std::chrono::steady_clock::duration seconds_duration(float seconds) {
    if (seconds <= 0.0f) {
        return std::chrono::steady_clock::duration::zero();
    }
    return std::chrono::duration_cast<std::chrono::steady_clock::duration>(
        std::chrono::duration<float>(seconds));
}
}  // namespace

NotificationState::NotificationState() = default;

uint64_t NotificationState::add_notification(const std::string& message,
                                             float duration,
                                             NotificationType type) {
    return add_notification_after(message, duration, 0.0f, type);
}

uint64_t NotificationState::add_notification_after(const std::string& message,
                                                   float duration,
                                                   float delay_seconds,
                                                   NotificationType type) {
    const uint64_t id = next_id_.fetch_add(1);
    {
        std::lock_guard<std::mutex> lock(mu_);
        prune_expired_locked(std::chrono::steady_clock::now());
        notifications_.push_back(make_notification(id, message, duration, delay_seconds, type, true));
        ++unread_count_;
        trim_history_locked();
    }
    return id;
}

uint64_t NotificationState::add_toast(const std::string& message,
                                      float duration,
                                      NotificationType type) {
    const uint64_t id = next_id_.fetch_add(1);
    std::lock_guard<std::mutex> lock(mu_);
    prune_expired_locked(std::chrono::steady_clock::now());
    notifications_.push_back(make_notification(id, message, duration, 0.0f, type, false));
    return id;
}

bool NotificationState::update_toast(uint64_t id,
                                     const std::string& message,
                                     float duration,
                                     NotificationType type) {
    return update_notification(id, message, duration, type);
}

bool NotificationState::update_notification(uint64_t id,
                                            const std::string& message,
                                            float duration,
                                            NotificationType type) {
    uint64_t replacement_id = 0;
    {
        std::lock_guard<std::mutex> lock(mu_);
        prune_expired_locked(std::chrono::steady_clock::now());
        auto it = std::find_if(notifications_.begin(), notifications_.end(), [id](const Notification& notification) {
            return notification.id == id;
        });
        if (it == notifications_.end()) {
            return false;
        }

        const bool show_in_activity = it->show_in_activity;
        it->toast_visible = false;
        replacement_id = next_id_.fetch_add(1);
        notifications_.push_back(make_notification(replacement_id, message, duration, 0.0f, type, show_in_activity));
        if (show_in_activity) {
            ++unread_count_;
        }
        trim_history_locked();
    }
    return true;
}

void NotificationState::dismiss(uint64_t id) {
    bool changed = false;
    {
        std::lock_guard<std::mutex> lock(mu_);
        const size_t old_size = notifications_.size();
        notifications_.erase(
            std::remove_if(notifications_.begin(), notifications_.end(), [id, this](const Notification& notification) {
                if (notification.id != id) {
                    return false;
                }
                if (notification.show_in_activity && !notification.read && unread_count_.load() > 0) {
                    --unread_count_;
                }
                return true;
            }),
            notifications_.end());
        changed = notifications_.size() != old_size;
    }
    (void)changed;
}

void NotificationState::update() {
    std::lock_guard<std::mutex> lock(mu_);
    prune_expired_locked(std::chrono::steady_clock::now());
}

std::vector<Notification> NotificationState::get_notifications() {
    std::lock_guard<std::mutex> lock(mu_);
    const auto now = std::chrono::steady_clock::now();
    prune_expired_locked(now);

    std::vector<Notification> visible;
    visible.reserve(std::min<std::size_t>(notifications_.size(), MAX_VISIBLE));
    for (auto it = notifications_.rbegin(); it != notifications_.rend() && visible.size() < MAX_VISIBLE; ++it) {
        if (it->toast_visible && it->visible_at <= now) {
            visible.push_back(*it);
        }
    }
    std::reverse(visible.begin(), visible.end());
    return visible;
}

std::vector<Notification> NotificationState::get_history() {
    std::lock_guard<std::mutex> lock(mu_);
    std::vector<Notification> history;
    history.reserve(notifications_.size());
    for (const auto& notification : notifications_) {
        if (notification.show_in_activity) {
            history.push_back(notification);
        }
    }
    return history;
}

size_t NotificationState::count() {
    std::lock_guard<std::mutex> lock(mu_);
    return static_cast<size_t>(std::count_if(notifications_.begin(), notifications_.end(), [](const Notification& notification) {
        return notification.show_in_activity;
    }));
}

size_t NotificationState::unread_count() const {
    return unread_count_.load();
}

void NotificationState::mark_all_read() {
    bool changed = false;
    {
        std::lock_guard<std::mutex> lock(mu_);
        for (auto& notification : notifications_) {
            if (notification.show_in_activity) {
                changed = changed || !notification.read;
                notification.read = true;
            }
        }
        unread_count_ = 0;
    }
    (void)changed;
}

void NotificationState::clear_history() {
    {
        std::lock_guard<std::mutex> lock(mu_);
        notifications_.erase(
            std::remove_if(notifications_.begin(), notifications_.end(), [](const Notification& notification) {
                return notification.show_in_activity;
            }),
            notifications_.end());
        unread_count_ = 0;
    }
}

Notification NotificationState::make_notification(uint64_t id,
                                                  const std::string& message,
                                                  float duration,
                                                  float delay_seconds,
                                                  NotificationType type,
                                                  bool show_in_activity) const {
    const auto now = std::chrono::steady_clock::now();
    Notification notification;
    notification.id = id;
    notification.message = message;
    notification.type = type;
    notification.timestamp = std::chrono::system_clock::now();
    notification.visible_at = now + seconds_duration(delay_seconds);
    notification.has_expiry = duration > 0.0f;
    notification.expires_at = notification.has_expiry
                                  ? notification.visible_at + seconds_duration(duration)
                                  : std::chrono::steady_clock::time_point::max();
    notification.toast_visible = true;
    notification.read = false;
    notification.show_in_activity = show_in_activity;
    return notification;
}

void NotificationState::prune_expired_locked(std::chrono::steady_clock::time_point now) {
    for (auto& notification : notifications_) {
        if (notification.toast_visible && notification.has_expiry && notification.expires_at <= now) {
            notification.toast_visible = false;
        }
    }
}

void NotificationState::trim_history_locked() {
    const size_t history_count = static_cast<size_t>(std::count_if(notifications_.begin(), notifications_.end(), [](const Notification& notification) {
        return notification.show_in_activity;
    }));
    if (history_count <= MAX_HISTORY) {
        return;
    }
    size_t remove_count = history_count - MAX_HISTORY;
    size_t removed_unread = 0;
    notifications_.erase(
        std::remove_if(notifications_.begin(), notifications_.end(), [&](const Notification& notification) {
            if (!notification.show_in_activity || remove_count == 0) {
                return false;
            }
            --remove_count;
            if (!notification.read) {
                ++removed_unread;
            }
            return true;
        }),
        notifications_.end());
    unread_count_ = unread_count_.load() > removed_unread ? unread_count_.load() - removed_unread : 0;
}

}  // namespace misty::panel
