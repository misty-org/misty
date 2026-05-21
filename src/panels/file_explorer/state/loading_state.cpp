#include "panels/file_explorer/state/loading_state.h"

namespace misty::panel {

void LoadingState::begin(uint64_t load_generation,
                         std::chrono::steady_clock::time_point now,
                         std::chrono::steady_clock::duration minimum_duration) {
    phase = LoadingAnimationPhase::Active;
    started_at = now;
    visible_until = now + minimum_duration;
    generation = load_generation;
}

void LoadingState::complete(uint64_t load_generation,
                            std::chrono::steady_clock::time_point now) {
    if (phase == LoadingAnimationPhase::Idle || generation != load_generation) {
        return;
    }

    if (now >= visible_until) {
        cancel();
        return;
    }

    phase = LoadingAnimationPhase::Completing;
}

void LoadingState::cancel() {
    phase = LoadingAnimationPhase::Idle;
    started_at = {};
    visible_until = {};
    generation = 0;
}

bool LoadingState::should_render(std::chrono::steady_clock::time_point now) {
    if (phase == LoadingAnimationPhase::Completing && now >= visible_until) {
        cancel();
    }

    return phase != LoadingAnimationPhase::Idle;
}

}  // namespace misty::panel
