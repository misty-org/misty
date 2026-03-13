#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include "core/ui/ui_registry.h"

namespace misty::panel {

    enum class NotificationType {
        INFO,
        SUCCESS,
        ERROR,
        DOWNLOAD
    };

    struct Notification {
        uint64_t id;
        std::string title;
        std::string message;
        NotificationType type;
        std::chrono::steady_clock::time_point created_at;
        float duration_seconds;  // How long to show (0 = until dismissed)
        bool dismissed = false;

        bool is_expired() const {
            if (duration_seconds <= 0) return false;
            auto elapsed = std::chrono::steady_clock::now() - created_at;
            return std::chrono::duration<float>(elapsed).count() >= duration_seconds;
        }

        float get_progress() const {
            if (duration_seconds <= 0) return 0.0f;
            auto elapsed = std::chrono::steady_clock::now() - created_at;
            float progress = std::chrono::duration<float>(elapsed).count() / duration_seconds;
            return std::min(1.0f, progress);
        }
    };

    class NotificationState : public core::UIState {
    public:
        static constexpr size_t MAX_VISIBLE = 5;
        static constexpr size_t MAX_HISTORY = 100;
        static constexpr float DEFAULT_DURATION = 5.0f;

        uint64_t add_notification(const std::string& title,
                                   const std::string& message,
                                   NotificationType type = NotificationType::INFO,
                                   float duration = DEFAULT_DURATION) {
            std::lock_guard<std::mutex> lock(mu);

            uint64_t id = next_id_++;
            Notification notif;
            notif.id = id;
            notif.title = title;
            notif.message = message;
            notif.type = type;
            notif.created_at = std::chrono::steady_clock::now();
            notif.duration_seconds = duration;

            notifications_.push_back(notif);

            // Also add to history
            history_.push_back(notif);
            while (history_.size() > MAX_HISTORY) {
                history_.erase(history_.begin());
            }

            // Remove oldest visible if we exceed max
            while (notifications_.size() > MAX_VISIBLE) {
                notifications_.erase(notifications_.begin());
            }

            return id;
        }

        void dismiss(uint64_t id) {
            std::lock_guard<std::mutex> lock(mu);
            for (auto& notif : notifications_) {
                if (notif.id == id) {
                    notif.dismissed = true;
                    break;
                }
            }
        }

        void update() {
            std::lock_guard<std::mutex> lock(mu);
            // Remove expired and dismissed notifications from active list
            notifications_.erase(
                std::remove_if(notifications_.begin(), notifications_.end(),
                    [](const Notification& n) { return n.dismissed || n.is_expired(); }),
                notifications_.end()
            );
        }

        std::vector<Notification> get_notifications() {
            std::lock_guard<std::mutex> lock(mu);
            return notifications_;
        }

        // Get full notification history for the activity view
        std::vector<Notification> get_history() {
            std::lock_guard<std::mutex> lock(mu);
            return history_;
        }

        void clear_history() {
            std::lock_guard<std::mutex> lock(mu);
            history_.clear();
        }

        size_t count() {
            std::lock_guard<std::mutex> lock(mu);
            return notifications_.size();
        }

        size_t history_count() {
            std::lock_guard<std::mutex> lock(mu);
            return history_.size();
        }

    private:
        std::mutex mu;
        std::vector<Notification> notifications_;  // Active toast notifications
        std::vector<Notification> history_;         // Full history for activity view
        std::atomic<uint64_t> next_id_{1};
    };

}
