#pragma once
#include "panels/panel/panel.h"
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"
#include "panels/onboarding/onboarding_state.h"

namespace misty::panel {

    class OnboardingPanel : public Panel {
    public:
        OnboardingPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool);
        ~OnboardingPanel() override = default;
        void render() override;

    private:
        void show_step_0_welcome   (OnboardingState& s);
        void show_step_1_overview  (OnboardingState& s);
        void show_step_2_signup    (OnboardingState& s);
        void show_step_3_connect   (OnboardingState& s);
        void show_step_4_tour      (OnboardingState& s);
        void show_step_5_pro       (OnboardingState& s);

        // Shared chrome
        void show_progress_dots(int current_step, int total_steps);
        bool show_primary_button(const char* label, float width, bool enabled = true);
        void show_ghost_button_link(const char* label, float width);

        core::UIRegistry&  registry_;
        core::WorkerPool&  worker_pool_;
    };

}
