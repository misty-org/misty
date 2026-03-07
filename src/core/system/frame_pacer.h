#pragma once

#include <algorithm>
#include <chrono>
#include <functional>

namespace misty::core {

enum class FramePacingMode {
    IDLE,
    ACTIVE,
};

class FramePacer {
public:
    struct WaitDecision {
        bool should_wait = false;
        double timeout_seconds = 0.0;
        FramePacingMode mode = FramePacingMode::ACTIVE;
    };

    FramePacer() = default;

    void set_wake_callback(std::function<void()> wake_callback) {
        wake_callback_ = std::move(wake_callback);
    }
    void activate() {
        active_instance_ = this;
    }
    static void request_immediate_frame() {
        if (active_instance_) {
            active_instance_->request_immediate_frame_local();
        }
    }

    void note_focus();
    void note_cursor_move();
    void note_scroll();
    void note_pointer_press();
    void note_key_press();
    void note_text_input();
    void note_continuous_activity(bool pointer_button_down, bool item_active);

    WaitDecision next_wait_decision();
    FramePacingMode current_mode() const;
    void render_debug_overlay() const;

private:
    using clock = std::chrono::steady_clock;
    using time_point = clock::time_point;

    static constexpr auto kActiveWindow = std::chrono::milliseconds(250);
    static constexpr auto kImmediateWindow = std::chrono::milliseconds(350);
    static constexpr double kIdleTimeoutSeconds = 1.0 / 10.0;

    void mark_active() {
        last_activity_at_ = clock::now();
    }
    static const char* mode_label(FramePacingMode mode);
    void request_immediate_frame_local() {
        const auto now = clock::now();
        last_activity_at_ = now;
        forced_active_until_ = std::max(forced_active_until_, now + kImmediateWindow);
        if (wake_callback_) {
            wake_callback_();
        }
    }

    time_point last_activity_at_ = clock::now();
    time_point forced_active_until_ = time_point{};
    std::function<void()> wake_callback_;
    static inline FramePacer* active_instance_ = nullptr;
};

}  // namespace misty::core
