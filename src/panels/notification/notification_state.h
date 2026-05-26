#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include "core/ui/state_registry.h"

namespace misty::panel {

    // Kept for use at call sites that route errors to Activity vs capsule toasts
    enum class NotificationType {
        INFO,
        SUCCESS,
        ERROR,
        DOWNLOAD
    };

    struct Notification {
        uint64_t id;
        std::string message;
        std::chrono::steady_clock::time_point created_at;
        float duration_seconds;
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

    class NotificationState : public core::StateEntry {
    public:
        static constexpr size_t MAX_VISIBLE = 3;
        static constexpr float DEFAULT_DURATION = 2.5f;

        uint64_t add_notification(const std::string& message,
                                   float duration = DEFAULT_DURATION) {
            std::lock_guard<std::mutex> lock(mu);

            uint64_t id = next_id_++;
            Notification notif;
            notif.id = id;
            notif.message = message;
            notif.created_at = std::chrono::steady_clock::now();
            notif.duration_seconds = duration;

            notifications_.push_back(notif);

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

        size_t count() {
            std::lock_guard<std::mutex> lock(mu);
            return notifications_.size();
        }

    private:
        std::mutex mu;
        std::vector<Notification> notifications_;
        std::atomic<uint64_t> next_id_{1};
    };

}
