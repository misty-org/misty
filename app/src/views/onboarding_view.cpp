#include "views/onboarding_view.h"
#include "panels/onboarding/onboarding_state.h"
#include "imgui.h"

namespace misty::view {

    OnboardingView::OnboardingView(core::UIRegistry& ui_registry,
                                   core::WorkerPool& worker_pool)
        : ui_registry_(ui_registry), worker_pool_(worker_pool)
    {
        panel_ = std::make_shared<panel::OnboardingPanel>(ui_registry_, worker_pool_);
    }

    ViewID OnboardingView::get_view_id() {
        return ViewID::Onboarding;
    }

    void OnboardingView::render() {
        // Window size varies by step
        auto& state = ui_registry_.get_state<panel::OnboardingState>("Onboarding");

        float height;
        switch (state.step) {
            case 0: height = 400.0f; break;
            case 1: height = 580.0f; break;
            case 2: height = 560.0f; break;
            case 3: height = 520.0f; break;
            case 4: height = 540.0f; break;
            case 5: height = 500.0f; break;
            default: height = 500.0f; break;
        }

        ImGuiViewport* vp = ImGui::GetMainViewport();
        float w = 500.0f;
        ImGui::SetNextWindowPos(
            ImVec2(vp->WorkPos.x + (vp->WorkSize.x - w)      * 0.5f,
                   vp->WorkPos.y + (vp->WorkSize.y - height)  * 0.5f),
            ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(w, height), ImGuiCond_Always);
        ImGui::SetNextWindowViewport(vp->ID);

        panel_->render();
    }

}
