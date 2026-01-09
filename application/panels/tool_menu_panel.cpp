#include "tool_menu_panel.h"

namespace minidfs {
    ToolMenuPanel::ToolMenuPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(client) {
    }

    void ToolMenuPanel::render() {
        auto& state = registry_.get_state<ToolMenuState>("ToolMenu");

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowViewport(viewport->ID);

        // 1. Calculate Responsive Width (1/5th of screen)
        float sidebar_width = viewport->WorkSize.x * 0.20f;

        // Clamp to sane limits so it doesn't vanish or cover everything
        if (sidebar_width < 160.0f) sidebar_width = 160.0f;

        // Position it at X=0 (or X=77 if you still have a thin navbar on the far left)
        float navbar_offset = 77.0f;
        ImGui::SetNextWindowPos(ImVec2(viewport->WorkPos.x + navbar_offset, viewport->WorkPos.y));
        ImGui::SetNextWindowSize(ImVec2(sidebar_width, viewport->WorkSize.y));

        ImGuiWindowFlags sidebar_flags = ImGuiWindowFlags_NoTitleBar |
			ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));

        if (ImGui::Begin("SideMenu", nullptr, sidebar_flags)) {
            // Use internal available width for all items
            float content_width = ImGui::GetContentRegionAvail().x;
            float padding = content_width * 0.08f; // 8% internal padding

            // Title - Scaled position
            ImGui::SetCursorPos(ImVec2(padding, 20));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            ImGui::Text("Home");
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0, 10)); // Responsive spacing

            // Pass the calculated width to sub-functions
            show_main_navigation(state, content_width, padding);

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            show_quick_access(content_width, padding);
            show_modals(state);

            // Anchored Storage Info (Fixed to bottom)
            show_storage_info(content_width, padding);
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void ToolMenuPanel::show_main_navigation(ToolMenuState& state, float width, float padding) {
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        // Padding scales with window width
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(padding, 12));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.25f, 0.25f, 0.25f, 0.6f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 0.8f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.35f, 0.35f, 0.35f, 1.0f));

        // Use a calculated button width (Window Width minus double padding)
        float b_width = width - (padding * 2);

        const char* labels[] = { "  All files", "  Photos", "  Shared", "  File requests", "  Deleted files" };
        for (const char* label : labels) {
            ImGui::SetCursorPosX(padding);
            if (ImGui::Button(label, ImVec2(b_width, 0))) { /* Handle */ }
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);
    }

    void ToolMenuPanel::show_quick_access(float width, float padding) {
        ImGui::SetCursorPosX(padding);
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
        ImGui::Text("Quick access");
        ImGui::SameLine(width - padding - 30); // Anchor "+" to the right
        if (ImGui::SmallButton("+")) { /* Add */ }
        ImGui::PopStyleColor();

        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.2f, 0.2f, 0.2f, 0.0f)); // Transparent header

        ImGui::SetCursorPosX(padding);
        // Headers fill the available width
        ImGui::PushItemWidth(width - (padding * 2));
        if (ImGui::CollapsingHeader("Starred", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::SetCursorPosX(padding + 10);
            ImGui::TextColored(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "(empty)");
        }

        ImGui::SetCursorPosX(padding);
        if (ImGui::CollapsingHeader("Untitled", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::SetCursorPosX(padding + 10);
            ImGui::TextWrapped("Drag important items here."); // Wrapped text prevents overflow
        }
        ImGui::PopItemWidth();
        ImGui::PopStyleColor();
    }

    void ToolMenuPanel::show_storage_info(float width, float padding) {
        // Position at bottom (140px from bottom edge)
        ImGui::SetCursorPosY(ImGui::GetWindowHeight() - 140);
        ImGui::SetCursorPosX(padding);

        float b_width = width - (padding * 2);

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.4f, 0.2f, 0.15f, 1.0f));

        // Multi-line text will now wrap or fit within b_width
        if (ImGui::Button("Upload anything\n2.36 GB / 2 GB\nUpgrade", ImVec2(b_width, 80))) {
            // Upgrade Logic
        }

        ImGui::PopStyleColor();
        ImGui::PopStyleVar();
    }

    void ToolMenuPanel::show_modals(ToolMenuState& state) {
        if (state.show_new_file_modal) {
            ImGui::OpenPopup("Create New File");
            if (ImGui::BeginPopupModal("Create New File", &state.show_new_file_modal, ImGuiWindowFlags_AlwaysAutoResize)) {
                ImGui::Text("Enter name for the new file:");

                // Bigger input field
                ImGui::PushItemWidth(300);
                ImGui::InputText("##filename", state.name_buffer, IM_ARRAYSIZE(state.name_buffer));
                ImGui::PopItemWidth();

                ImGui::Spacing();

                // Bigger buttons with padding
                ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(20, 10));

                if (ImGui::Button("Cancel", ImVec2(120, 0))) {
                    state.show_new_file_modal = false;
                }
                ImGui::SameLine();
                if (ImGui::Button("Create", ImVec2(120, 0))) {
                    // this->dispatch_create_file(state.name_buffer);
                    state.show_new_file_modal = false;
                }

                ImGui::PopStyleVar();
                ImGui::EndPopup();
            }
        }

        if (state.show_new_folder_modal) {
            ImGui::OpenPopup("Create New Folder");
            if (ImGui::BeginPopupModal("Create New Folder", &state.show_new_folder_modal, ImGuiWindowFlags_AlwaysAutoResize)) {
                ImGui::Text("Enter name for the new folder:");

                // Bigger input field
                ImGui::PushItemWidth(300);
                ImGui::InputText("##foldername", state.name_buffer, IM_ARRAYSIZE(state.name_buffer));
                ImGui::PopItemWidth();

                ImGui::Spacing();

                // Bigger buttons with padding
                ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(20, 10));

                if (ImGui::Button("Cancel", ImVec2(120, 0))) {
                    state.show_new_folder_modal = false;
                }
                ImGui::SameLine();
                if (ImGui::Button("Create", ImVec2(120, 0))) {
                    // this->dispatch_create_folder(state.name_buffer);
                    state.show_new_folder_modal = false;
                }

                ImGui::PopStyleVar();
                ImGui::EndPopup();
            }
        }
    }
}