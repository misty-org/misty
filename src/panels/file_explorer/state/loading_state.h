#pragma once

#include <chrono>
#include <cstdint>

namespace misty::panel {

/**
 * @brief Render phase for the explorer's minimum-duration loading animation.
 */
enum class LoadingAnimationPhase {
    Idle,
    Active,
    Completing,
};

/**
 * @brief Tracks loading animation timing for one file listing.
 */
struct LoadingState {
    LoadingAnimationPhase phase = LoadingAnimationPhase::Idle;
    std::chrono::steady_clock::time_point started_at{};
    std::chrono::steady_clock::time_point visible_until{};
    uint64_t generation = 0;

    /**
     * @brief Starts a loading animation cycle for a navigation generation.
     */
    void begin(uint64_t load_generation,
               std::chrono::steady_clock::time_point now,
               std::chrono::steady_clock::duration minimum_duration);

    /**
     * @brief Requests completion after the minimum visible duration elapses.
     */
    void complete(uint64_t load_generation,
                  std::chrono::steady_clock::time_point now);

    /**
     * @brief Stops the animation and clears generation metadata.
     */
    void cancel();

    /**
     * @brief Returns true when the loading animation should be drawn.
     */
    bool should_render(std::chrono::steady_clock::time_point now);
};

}  // namespace misty::panel
