#include "vault_panel.h"

#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <sstream>

#include "core/system/util.h"
#include "core/ui/ui_style.h"
#include "views/app_view.h"

namespace misty::panel {

    namespace {
        struct ButtonStyle {
            ImVec4 button;
            ImVec4 hovered;
            ImVec4 active;
            ImVec4 text;
            float rounding;
        };

        ButtonStyle primary_button_style() {
            return {
                ImVec4(0.957f, 0.957f, 0.961f, 1.0f),
                ImVec4(0.898f, 0.906f, 0.922f, 1.0f),
                ImVec4(0.820f, 0.835f, 0.859f, 1.0f),
                ImVec4(0.07f, 0.07f, 0.07f, 1.0f),
                8.0f,
            };
        }

        bool styled_button(const char* label, const ImVec2& size, const ButtonStyle& style) {
            bool pressed = false;
            misty::UI::WithStyle([&](misty::UI::StyleScope& scoped) {
                scoped.var(ImGuiStyleVar_FrameRounding, style.rounding);
                scoped.color(ImGuiCol_Button, style.button);
                scoped.color(ImGuiCol_ButtonHovered, style.hovered);
                scoped.color(ImGuiCol_ButtonActive, style.active);
                scoped.color(ImGuiCol_Text, style.text);
                pressed = ImGui::Button(label, size);
            });
            return pressed;
        }

        void text_colored(const ImVec4& color, const char* fmt, ...) {
            char buffer[1024];
            va_list args;
            va_start(args, fmt);
            std::vsnprintf(buffer, sizeof(buffer), fmt, args);
            va_end(args);

            misty::UI::WithTextColor(color, [&]() {
                ImGui::TextUnformatted(buffer);
            });
        }

        std::vector<std::string> split_lines(const char* buf) {
            std::vector<std::string> out;
            if (!buf) return out;
            std::stringstream ss(buf);
            std::string line;
            while (std::getline(ss, line)) {
                if (!line.empty() && line.back() == '\r') line.pop_back();
                if (!line.empty()) out.push_back(line);
            }
            return out;
        }

        std::vector<std::string> split_csv(const char* buf) {
            std::vector<std::string> out;
            if (!buf) return out;
            std::string s(buf), tok;
            std::stringstream ss(s);
            while (std::getline(ss, tok, ',')) {
                while (!tok.empty() && (tok.front() == ' ' || tok.front() == '\t')) tok.erase(tok.begin());
                while (!tok.empty() && (tok.back() == ' ' || tok.back() == '\t')) tok.pop_back();
                if (!tok.empty()) out.push_back(tok);
            }
            return out;
        }

    } // namespace

    VaultPanel::VaultPanel(core::UIRegistry& registry) : registry_(registry) {}

    void VaultPanel::render() {
        auto& state = registry_.get_state<VaultState>("Vault");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        misty::UI::WithWindowStyle({
            .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
            .padding = ImVec2(32.0f, 24.0f),
        }, [&]() {
            if (ImGui::Begin("VaultPanel", nullptr, flags)) {
                {
                    const auto repo_snapshot = state.repos_snapshot();
                    std::lock_guard<std::mutex> lock(state.mu);
                    misty::view::debug_log_view_event(
                        std::string("vault_panel: repos=") + std::to_string(repo_snapshot.size()) +
                        " refreshing=" + (state.is_refreshing ? "true" : "false") +
                        " selected=" + (state.selected_repo.empty() ? "<none>" : state.selected_repo));
                }
                show_header(state);
                ImGui::Spacing();

                show_repos_section(state);

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                show_snapshots_section(state);

                show_job_progress_card(state);

                // Error display
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (!state.error_msg.empty()) {
                        ImGui::Spacing();
                        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                        ImGui::TextWrapped("%s", state.error_msg.c_str());
                        ImGui::PopStyleColor();
                    }
                }

                show_create_repo_modal(state);
                show_backup_modal(state);
                show_restore_modal(state);
            }
            ImGui::End();
        });
    }

    void VaultPanel::show_header(VaultState& state) {
        ImGui::BeginGroup();
        misty::UI::WithFontScale(1.8f, []() {
            text_colored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Vault");
        });
        text_colored(ImVec4(0.7f, 0.7f, 0.7f, 1.0f),
            "Encrypted, deduplicated backups powered by restic.");
        ImGui::EndGroup();

        ImGui::SameLine();
        float avail = ImGui::GetContentRegionAvail().x;
        // Right-align the action buttons.
        const float refresh_w = 84.0f;
        const float new_w = 150.0f;
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + avail - (refresh_w + new_w + 8.0f));

        bool refreshing = false;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            refreshing = state.is_refreshing;
        }

        if (refreshing) ImGui::BeginDisabled();
        if (styled_button("Refresh", ImVec2(refresh_w, 30.0f), primary_button_style())) {
            state.refresh_repos();
        }
        if (refreshing) ImGui::EndDisabled();

        ImGui::SameLine(0, 8.0f);

        if (styled_button("+ New Repository", ImVec2(new_w, 30.0f), primary_button_style())) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.show_create_repo_modal = true;
            state.create_name_buf[0] = 0;
            state.create_url_buf[0] = 0;
            state.create_password_buf[0] = 0;
        }
    }

    void VaultPanel::show_repos_section(VaultState& state) {
        auto repos = state.repos_snapshot();

        if (repos.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
            ImGui::TextWrapped("No vault repositories yet. Click \"+ New Repository\" to create one. "
                               "Use a local path (local:/some/dir) or an rclone-backed remote "
                               "(rclone:onedrive-x:/backups).");
            ImGui::PopStyleColor();
            return;
        }

        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(kCardSpacing, kCardSpacing));
        int cards_drawn = 0;
        for (const auto& repo : repos) {
            if (cards_drawn > 0) {
                float next_end = ImGui::GetItemRectMax().x - ImGui::GetWindowPos().x + kCardSpacing + kCardWidth;
                float window_width = ImGui::GetContentRegionAvail().x + ImGui::GetCursorPosX();
                if (next_end <= window_width) {
                    ImGui::SameLine(0.0f, kCardSpacing);
                }
            }
            show_repo_card(state, repo);
            cards_drawn++;
        }
        ImGui::PopStyleVar();
    }

    void VaultPanel::show_repo_card(VaultState& state, const VaultRepo& repo) {
        ImGui::PushID(repo.name.c_str());
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);

        bool is_selected;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            is_selected = state.selected_repo == repo.name;
        }

        ImVec4 bg = is_selected
            ? ImVec4(0.20f, 0.22f, 0.30f, 1.0f)
            : ImVec4(0.14f, 0.14f, 0.15f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, bg);

        if (ImGui::BeginChild("Card", ImVec2(kCardWidth, kCardHeight), true)) {
            // URL line (provider hint)
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
            ImGui::TextWrapped("%s", repo.url.c_str());
            ImGui::PopStyleColor();

            ImGui::Spacing();
            misty::UI::WithFontScale(1.2f, [&]() {
                text_colored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", repo.name.c_str());
            });
            ImGui::Spacing();
            ImGui::Spacing();

            // Action row
            if (ImGui::Button("Select", ImVec2(72.0f, 26.0f))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.selected_repo = repo.name;
                state.selected_snapshot.clear();
                // refresh outside the lock
            }
            // Trigger refresh once (after lock release) — cheap to dedupe
            // server-side, so we just always re-fetch on Select.
            if (is_selected) {
                // no-op — refresh fired on click below
            }
            ImGui::SameLine(0, 6.0f);
            if (ImGui::Button("Backup...", ImVec2(86.0f, 26.0f))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.selected_repo = repo.name;
                state.show_backup_modal = true;
                state.backup_paths_buf[0] = 0;
                state.backup_tags_buf[0] = 0;
            }
            ImGui::SameLine(0, 6.0f);
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.55f, 0.18f, 0.18f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.28f, 0.28f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.45f, 0.12f, 0.12f, 1.0f));
            if (ImGui::Button("Delete", ImVec2(70.0f, 26.0f))) {
                pending_delete_repo_ = repo.name;
                ImGui::OpenPopup("##vault_confirm_delete");
            }
            ImGui::PopStyleColor(3);
        }
        ImGui::EndChild();

        // Side-effect: clicking Select fires the snapshot refresh.
        if (ImGui::IsItemClicked(ImGuiMouseButton_Left) && !is_selected) {
            // Already handled above — IsItemClicked on the BeginChild region
            // is unreliable; we leave the explicit Select button as the
            // canonical entry point.
        }

        // Confirm-delete popup, scoped to this card's PushID stack so the
        // popup ID resolves correctly (same trick ServicesPanel uses).
        ImVec2 vp_center = ImGui::GetMainViewport()->GetCenter();
        ImGui::SetNextWindowPos(vp_center, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        if (ImGui::BeginPopupModal("##vault_confirm_delete", nullptr,
                                   ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoTitleBar)) {
            ImGui::TextWrapped("Delete vault repository \"%s\"?\n"
                               "This only removes it from misty's registry — restic data on disk "
                               "or in the rclone target is left intact.", pending_delete_repo_.c_str());
            ImGui::Spacing();
            if (ImGui::Button("Cancel", ImVec2(120, 0))) {
                pending_delete_repo_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.55f, 0.18f, 0.18f, 1.0f));
            if (ImGui::Button("Delete", ImVec2(120, 0))) {
                state.delete_repo(pending_delete_repo_);
                pending_delete_repo_.clear();
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor();
            ImGui::EndPopup();
        }

        ImGui::PopStyleColor();   // ChildBg
        ImGui::PopStyleVar();     // ChildRounding
        ImGui::PopID();
    }

    void VaultPanel::show_snapshots_section(VaultState& state) {
        std::string repo_name;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            repo_name = state.selected_repo;
        }
        if (repo_name.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
            ImGui::Text("Select a repository to browse snapshots.");
            ImGui::PopStyleColor();
            return;
        }

        ImGui::PushID("snapshots");
        ImGui::BeginGroup();
        misty::UI::WithFontScale(1.3f, [&]() {
            text_colored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Snapshots — %s", repo_name.c_str());
        });
        ImGui::SameLine();
        float avail = ImGui::GetContentRegionAvail().x;
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + avail - 90.0f);
        if (ImGui::Button("Refresh", ImVec2(84.0f, 26.0f))) {
            state.refresh_snapshots(repo_name);
        }
        ImGui::EndGroup();

        auto snaps = state.snapshots_for(repo_name);
        if (snaps.empty()) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
            ImGui::TextWrapped("No snapshots yet. Click \"Refresh\" to fetch the latest list, "
                               "or run a backup against this repository.");
            ImGui::PopStyleColor();
            ImGui::PopID();
            return;
        }

        ImGui::Spacing();
        if (ImGui::BeginTable("##vault_snapshots", 5,
                              ImGuiTableFlags_RowBg | ImGuiTableFlags_BordersInnerH |
                              ImGuiTableFlags_SizingStretchProp | ImGuiTableFlags_ScrollY,
                              ImVec2(0, 240.0f))) {
            ImGui::TableSetupColumn("ID",       ImGuiTableColumnFlags_WidthFixed, 100.0f);
            ImGui::TableSetupColumn("Time",     ImGuiTableColumnFlags_WidthFixed, 200.0f);
            ImGui::TableSetupColumn("Host",     ImGuiTableColumnFlags_WidthFixed, 140.0f);
            ImGui::TableSetupColumn("Paths",    ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("",         ImGuiTableColumnFlags_WidthFixed, 90.0f);
            ImGui::TableHeadersRow();

            for (const auto& s : snaps) {
                ImGui::PushID(s.id.c_str());
                ImGui::TableNextRow();
                ImGui::TableNextColumn(); ImGui::Text("%s", s.id.c_str());
                ImGui::TableNextColumn(); ImGui::Text("%s", s.time.c_str());
                ImGui::TableNextColumn(); ImGui::Text("%s", s.hostname.c_str());
                ImGui::TableNextColumn();
                {
                    std::string joined;
                    for (size_t i = 0; i < s.paths.size(); ++i) {
                        if (i) joined += ", ";
                        joined += s.paths[i];
                    }
                    ImGui::TextWrapped("%s", joined.c_str());
                }
                ImGui::TableNextColumn();
                if (ImGui::Button("Restore...", ImVec2(80.0f, 22.0f))) {
                    std::lock_guard<std::mutex> lock(state.mu);
                    state.selected_snapshot = s.id;
                    state.show_restore_modal = true;
                    state.restore_target_buf[0] = 0;
                }
                ImGui::PopID();
            }
            ImGui::EndTable();
        }
        ImGui::PopID();
    }

    void VaultPanel::show_job_progress_card(VaultState& state) {
        VaultJobProgress p;
        if (!state.latest_job(p)) return;

        ImGui::Spacing();
        ImGui::Spacing();
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.12f, 0.13f, 0.15f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        if (ImGui::BeginChild("##vault_job", ImVec2(0, 130.0f), true)) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::Text("%s", p.job_type.c_str());
            ImGui::PopStyleColor();
            ImGui::SameLine();

            ImVec4 state_color = ImVec4(0.6f, 0.6f, 0.6f, 1.0f);
            if (p.state == "succeeded") state_color = ImVec4(0.3f, 0.8f, 0.4f, 1.0f);
            else if (p.state == "failed" || p.state == "cancelled") state_color = ImVec4(0.85f, 0.3f, 0.3f, 1.0f);
            else state_color = ImVec4(0.95f, 0.78f, 0.30f, 1.0f);
            ImGui::PushStyleColor(ImGuiCol_Text, state_color);
            ImGui::Text("[%s]", p.state.c_str());
            ImGui::PopStyleColor();

            ImGui::SameLine();
            float avail = ImGui::GetContentRegionAvail().x;
            ImGui::SetCursorPosX(ImGui::GetCursorPosX() + avail - 80.0f);
            if (p.state == "running") {
                ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.55f, 0.18f, 0.18f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.28f, 0.28f, 1.0f));
                if (ImGui::Button("Cancel", ImVec2(74.0f, 22.0f))) {
                    state.cancel_job(p.job_id);
                }
                ImGui::PopStyleColor(2);
            }

            ImGui::Spacing();
            float frac = static_cast<float>(p.percent_done);
            if (frac < 0.0f) frac = 0.0f;
            if (frac > 1.0f) frac = 1.0f;
            char overlay[64];
            std::snprintf(overlay, sizeof(overlay), "%.1f%% — %lld/%lld files",
                          frac * 100.0f, (long long)p.files_processed, (long long)p.total_files);
            ImGui::ProgressBar(frac, ImVec2(-FLT_MIN, 0), overlay);

            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
            ImGui::Text("%s / %s   |   elapsed %.1fs   |   ETA %.1fs",
                        core::format_bytes(static_cast<int64_t>(p.bytes_processed)).c_str(),
                        core::format_bytes(static_cast<int64_t>(p.total_bytes)).c_str(),
                        p.seconds_elapsed, p.seconds_remaining);
            if (!p.current_file.empty()) {
                ImGui::TextWrapped("%s", p.current_file.c_str());
            }
            if (!p.error.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                ImGui::TextWrapped("%s", p.error.c_str());
                ImGui::PopStyleColor();
            }
            ImGui::PopStyleColor();
        }
        ImGui::EndChild();
        ImGui::PopStyleVar();
        ImGui::PopStyleColor();
    }

    // ---- Modals -----------------------------------------------------------

    void VaultPanel::show_create_repo_modal(VaultState& state) {
        bool open;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            open = state.show_create_repo_modal;
        }
        if (!open) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(500.0f, 0.0f), ImGuiCond_Always);
        ImGui::OpenPopup("##vault_create_repo");
        if (ImGui::BeginPopupModal("##vault_create_repo", nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                   ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {
            misty::UI::WithFontScale(1.3f, []() {
                text_colored(ImVec4(0.95f, 0.95f, 0.95f, 1.0f), "New vault repository");
            });
            ImGui::Spacing();
            ImGui::TextWrapped(
                "Pick a name and target. Local paths use the local: scheme, "
                "rclone targets use rclone:<remote>:<path>. The password "
                "encrypts everything in the repository — losing it means "
                "losing your backups, so store it somewhere safe.");
            ImGui::Spacing();

            ImGui::Text("Name");
            ImGui::InputText("##name", state.create_name_buf, sizeof(state.create_name_buf));
            ImGui::Text("URL");
            ImGui::InputText("##url", state.create_url_buf, sizeof(state.create_url_buf));
            ImGui::Text("Password");
            ImGui::InputText("##pwd", state.create_password_buf, sizeof(state.create_password_buf),
                             ImGuiInputTextFlags_Password);

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float w = ImGui::GetContentRegionAvail().x;
            float half = (w - 8.0f) * 0.5f;
            if (ImGui::Button("Cancel", ImVec2(half, 36.0f))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.show_create_repo_modal = false;
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine(0, 8.0f);
            bool can_submit = state.create_name_buf[0] && state.create_url_buf[0] && state.create_password_buf[0];
            if (!can_submit) ImGui::BeginDisabled();
            if (ImGui::Button("Create", ImVec2(half, 36.0f))) {
                std::string n = state.create_name_buf;
                std::string u = state.create_url_buf;
                std::string p = state.create_password_buf;
                state.create_repo(n, u, p);
                std::lock_guard<std::mutex> lock(state.mu);
                state.show_create_repo_modal = false;
                ImGui::CloseCurrentPopup();
            }
            if (!can_submit) ImGui::EndDisabled();

            ImGui::EndPopup();
        }
    }

    void VaultPanel::show_backup_modal(VaultState& state) {
        bool open;
        std::string repo_name;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            open = state.show_backup_modal;
            repo_name = state.selected_repo;
        }
        if (!open) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(560.0f, 0.0f), ImGuiCond_Always);
        ImGui::OpenPopup("##vault_backup");
        if (ImGui::BeginPopupModal("##vault_backup", nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                   ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {
            misty::UI::WithFontScale(1.3f, [&]() {
                text_colored(ImVec4(0.95f, 0.95f, 0.95f, 1.0f), "Backup → %s", repo_name.c_str());
            });
            ImGui::Spacing();
            ImGui::Text("Paths (one per line)");
            ImGui::InputTextMultiline("##paths", state.backup_paths_buf, sizeof(state.backup_paths_buf),
                                      ImVec2(-FLT_MIN, 120.0f));
            ImGui::Text("Tags (comma-separated, optional)");
            ImGui::InputText("##tags", state.backup_tags_buf, sizeof(state.backup_tags_buf));

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float w = ImGui::GetContentRegionAvail().x;
            float half = (w - 8.0f) * 0.5f;
            if (ImGui::Button("Cancel", ImVec2(half, 36.0f))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.show_backup_modal = false;
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine(0, 8.0f);
            bool can_submit = state.backup_paths_buf[0] != 0 && !repo_name.empty();
            if (!can_submit) ImGui::BeginDisabled();
            if (ImGui::Button("Start backup", ImVec2(half, 36.0f))) {
                auto paths = split_lines(state.backup_paths_buf);
                auto tags  = split_csv(state.backup_tags_buf);
                state.start_backup(repo_name, paths, tags);
                std::lock_guard<std::mutex> lock(state.mu);
                state.show_backup_modal = false;
                ImGui::CloseCurrentPopup();
            }
            if (!can_submit) ImGui::EndDisabled();

            ImGui::EndPopup();
        }
    }

    void VaultPanel::show_restore_modal(VaultState& state) {
        bool open;
        std::string repo_name, snap_id;
        {
            std::lock_guard<std::mutex> lock(state.mu);
            open = state.show_restore_modal;
            repo_name = state.selected_repo;
            snap_id   = state.selected_snapshot;
        }
        if (!open) return;

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(vp->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(560.0f, 0.0f), ImGuiCond_Always);
        ImGui::OpenPopup("##vault_restore");
        if (ImGui::BeginPopupModal("##vault_restore", nullptr,
                                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                                   ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_AlwaysAutoResize)) {
            misty::UI::WithFontScale(1.3f, [&]() {
                text_colored(ImVec4(0.95f, 0.95f, 0.95f, 1.0f),
                                  "Restore snapshot %s → %s", snap_id.c_str(), repo_name.c_str());
            });
            ImGui::Spacing();
            ImGui::TextWrapped(
                "The selected snapshot will be restored to the target directory. "
                "Existing files will be overwritten where they conflict.");
            ImGui::Spacing();
            ImGui::Text("Target directory");
            ImGui::InputText("##target", state.restore_target_buf, sizeof(state.restore_target_buf));

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float w = ImGui::GetContentRegionAvail().x;
            float half = (w - 8.0f) * 0.5f;
            if (ImGui::Button("Cancel", ImVec2(half, 36.0f))) {
                std::lock_guard<std::mutex> lock(state.mu);
                state.show_restore_modal = false;
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine(0, 8.0f);
            bool can_submit = state.restore_target_buf[0] != 0 && !repo_name.empty() && !snap_id.empty();
            if (!can_submit) ImGui::BeginDisabled();
            if (ImGui::Button("Restore", ImVec2(half, 36.0f))) {
                std::string target = state.restore_target_buf;
                state.start_restore(repo_name, snap_id, target);
                std::lock_guard<std::mutex> lock(state.mu);
                state.show_restore_modal = false;
                ImGui::CloseCurrentPopup();
            }
            if (!can_submit) ImGui::EndDisabled();

            ImGui::EndPopup();
        }
    }
}
