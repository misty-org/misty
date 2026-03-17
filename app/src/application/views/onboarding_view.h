#pragma once
#include <memory>
#include "views/app_view.h"
#include "panels/onboarding/onboarding_panel.h"
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"

namespace misty::view {

    class OnboardingView : public AppView {
    public:
        OnboardingView(core::UIRegistry& ui_registry, core::WorkerPool& worker_pool);
        ~OnboardingView() override = default;

        void render()           override;
        ViewID get_view_id()    override;

    private:
        core::UIRegistry& ui_registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<panel::OnboardingPanel> panel_;
    };

}
