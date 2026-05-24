#pragma once

#include <string>

#include "panels/panel/panel.h"
#include "core/ui/state_registry.h"
#include "vault_state.h"

namespace misty::panel {

    // VaultPanel is the right-hand side of the MVault screen. It renders:
    //   - a header with a "+ New Repository" action
    //   - a list of repos as cards (click to select)
    //   - the snapshots section for the selected repo
    //   - a job-progress card sourced from the live SSE stream
    //   - modals for create-repo, start-backup, restore
    class VaultPanel : public Panel {
    public:
        explicit VaultPanel(core::StateRegistry& registry);
        ~VaultPanel() override = default;
        void render() override;

    private:
        void show_header(VaultState& state);
        void show_repos_section(VaultState& state);
        void show_repo_card(VaultState& state, const VaultRepo& repo);
        void show_snapshots_section(VaultState& state);
        void show_job_progress_card(VaultState& state);

        void show_create_repo_modal(VaultState& state);
        void show_backup_modal(VaultState& state);
        void show_restore_modal(VaultState& state);

        // Pending delete confirmation, set from the repo card and consumed
        // by the disconnect modal (same pattern as ProvidersPanel).
        std::string pending_delete_repo_;

        static constexpr float kCardWidth   = 300.0f;
        static constexpr float kCardHeight  = 140.0f;
        static constexpr float kCardSpacing = 12.0f;

        core::StateRegistry& registry_;
    };
}
