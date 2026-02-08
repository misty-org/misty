#include "panels/onboarding/onboarding_panel.h"
#include "panels/services/services_state.h"
#include "core/manager/asset_manager.h"
#include "core/ui/imgui_utils.h"
#include "views/app_view.h"
#include "imgui.h"
#include <chrono>
#include <cstring>

namespace misty::panel {

// ─── helpers ─────────────────────────────────────────────────────────────────

    static void centered_text(const char* text, ImU32 color = IM_COL32(220, 220, 220, 255)) {
        float w = ImGui::GetContentRegionAvail().x;
        float tw = ImGui::CalcTextSize(text).x;
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + (w - tw) * 0.5f);
        ImGui::GetWindowDrawList()->AddText(
            ImGui::GetCursorScreenPos(), color, text);
        ImGui::Dummy(ImVec2(tw, ImGui::GetTextLineHeight()));
    }

    static void centered_text_wrapped(const char* text, ImU32 color) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(color));
        ImGui::TextWrapped("%s", text);
        ImGui::PopStyleColor();
    }

// ─── construction ────────────────────────────────────────────────────────────

    OnboardingPanel::OnboardingPanel(core::UIRegistry& registry,
                                     core::WorkerPool& worker_pool)
        : registry_(registry), worker_pool_(worker_pool) {}

// ─── shared chrome ───────────────────────────────────────────────────────────

    void OnboardingPanel::show_progress_dots(int current_step, int total_steps) {
        float avail = ImGui::GetContentRegionAvail().x;
        float dot_r   = 4.0f;
        float spacing = 14.0f;
        float total_w = total_steps * (dot_r * 2.0f) + (total_steps - 1) * (spacing - dot_r * 2.0f);
        float start_x = ImGui::GetCursorScreenPos().x + (avail - total_w) * 0.5f;
        float y       = ImGui::GetCursorScreenPos().y + dot_r;

        ImDrawList* dl = ImGui::GetWindowDrawList();
        for (int i = 0; i < total_steps; ++i) {
            float cx = start_x + i * spacing;
            bool  active = (i == current_step - 1);  // step 1 = dot 0
            ImU32 col = active
                ? IM_COL32(240, 240, 240, 255)
                : IM_COL32(80, 80, 80, 255);
            dl->AddCircleFilled(ImVec2(cx, y), dot_r, col);
        }
        ImGui::Dummy(ImVec2(avail, dot_r * 2.0f + 2.0f));
    }

    bool OnboardingPanel::show_primary_button(const char* label, float width, bool enabled) {
        if (!enabled) ImGui::BeginDisabled();
        bool clicked = core::StyledButton(label, ImVec2(width, 44.0f),
                                          core::ButtonTheme::Primary());
        if (!enabled) ImGui::EndDisabled();
        return clicked;
    }

    void OnboardingPanel::show_ghost_button_link(const char* label, float width) {
        ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(1, 1, 1, 0.06f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(1, 1, 1, 0.10f));
        ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::Button(label, ImVec2(width, 44.0f));
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(4);
    }

// ─── render dispatcher ───────────────────────────────────────────────────────

    void OnboardingPanel::render() {
        auto& state = registry_.get_state<OnboardingState>("Onboarding");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar  |
            ImGuiWindowFlags_NoResize    |
            ImGuiWindowFlags_NoMove      |
            ImGuiWindowFlags_NoCollapse  |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoDocking;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.067f, 0.067f, 0.075f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(40.0f, 36.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,   ImVec2(0.0f,  12.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,  ImVec2(12.0f, 10.0f));

        if (ImGui::Begin("Onboarding", nullptr, flags)) {
            switch (state.step) {
                case 0: show_step_0_welcome (state); break;
                case 1: show_step_1_overview(state); break;
                case 2: show_step_2_signup  (state); break;
                case 3: show_step_3_connect (state); break;
                case 4: show_step_4_tour    (state); break;
                case 5: show_step_5_pro     (state); break;
                default: break;
            }
        }
        ImGui::End();

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor();
    }

// ─── Step 0 — Welcome ────────────────────────────────────────────────────────

    void OnboardingPanel::show_step_0_welcome(OnboardingState& state) {
        float w = ImGui::GetContentRegionAvail().x;

        ImGui::Spacing();
        ImGui::Spacing();

        // Cloud icon
        auto& icon = core::AssetManager::get().get_svg_texture("cloud-24", 56);
        if (icon.id) {
            ImGui::SetCursorPosX((w - 56.0f) * 0.5f);
            ImGui::Image(icon.id, ImVec2(56.0f, 56.0f));
        }

        ImGui::Spacing();
        ImGui::Spacing();

        // Title
        ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
        centered_text("Welcome to Misty", IM_COL32(240, 240, 240, 255));
        ImGui::PopFont();

        ImGui::Spacing();

        centered_text("Your unified cloud file explorer.",
                      IM_COL32(130, 130, 130, 255));

        ImGui::Spacing();
        ImGui::Spacing();
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        ImGui::Spacing();

        // "I'm new here" — primary
        if (show_primary_button("I'm new here", w)) {
            state.advance();
        }

        ImGui::Spacing();

        // "I've used Misty before" — ghost
        ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.14f, 0.14f, 0.16f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.20f, 0.20f, 0.23f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.12f, 0.12f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.75f, 0.75f, 0.75f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        if (ImGui::Button("I've used Misty before", ImVec2(w, 44.0f))) {
            view::switch_view(view::ViewID::Login);
        }
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(4);
    }

// ─── Step 1 — Overview + Agreements ─────────────────────────────────────────

    void OnboardingPanel::show_step_1_overview(OnboardingState& state) {
        float w = ImGui::GetContentRegionAvail().x;

        show_progress_dots(1, 4);
        ImGui::Spacing();

        ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
        centered_text("What is Misty?", IM_COL32(240, 240, 240, 255));
        ImGui::PopFont();

        ImGui::Spacing();
        centered_text("One place for all your files.", IM_COL32(120, 120, 120, 255));
        ImGui::Spacing();
        ImGui::Spacing();

        // Overview body
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.72f, 0.72f, 0.72f, 1.0f));
        ImGui::TextWrapped(
            "Misty is a desktop file explorer that connects OneDrive, Google Drive, "
            "Dropbox, and iCloud into a single unified interface. Browse, upload, "
            "download, and organise files across all your cloud accounts without "
            "switching between apps.");
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        // Scrollable TOS placeholder
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
        ImGui::TextUnformatted("Terms of Service & Privacy Policy");
        ImGui::PopStyleColor();

        ImGui::Spacing();

        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.10f, 0.10f, 0.11f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
        if (ImGui::BeginChild("##tos", ImVec2(w, 150.0f), true)) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.60f, 0.60f, 0.60f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 6.0f));

            const char* placeholder =
                "1. Acceptance of Terms\n"
                "By using Misty you agree to these terms. Placeholder text — "
                "full legal copy will be inserted before release.\n\n"
                "2. Privacy Policy\n"
                "We collect only the data required to operate the service. "
                "Your cloud credentials are never stored on Misty servers. "
                "Placeholder — full policy text will be inserted before release.\n\n"
                "3. Acceptable Use\n"
                "You may not use Misty to store or distribute illegal content. "
                "Placeholder text.\n\n"
                "4. Limitation of Liability\n"
                "Misty is provided as-is. Placeholder — full clause will be "
                "inserted before release.\n\n"
                "5. Changes to Terms\n"
                "We may update these terms with notice. Continued use constitutes "
                "acceptance. Placeholder text.";

            ImGui::TextWrapped("%s", placeholder);
            ImGui::PopStyleVar();
            ImGui::PopStyleColor();
        }
        ImGui::EndChild();
        ImGui::PopStyleVar();
        ImGui::PopStyleColor();

        ImGui::Spacing();

        // Agree checkbox
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.80f, 0.80f, 0.80f, 1.0f));
        ImGui::Checkbox("I have read and agree to the Terms of Service and Privacy Policy",
                        &state.agree_to_terms);
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Spacing();

        if (show_primary_button("Next", w, state.agree_to_terms)) {
            state.advance();
        }
    }

// ─── Step 2 — Sign Up ────────────────────────────────────────────────────────

    void OnboardingPanel::show_step_2_signup(OnboardingState& state) {
        float w = ImGui::GetContentRegionAvail().x;

        show_progress_dots(2, 4);
        ImGui::Spacing();

        ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
        centered_text("Create your account", IM_COL32(240, 240, 240, 255));
        ImGui::PopFont();

        ImGui::Spacing();
        centered_text("It only takes a moment.", IM_COL32(120, 120, 120, 255));
        ImGui::Spacing();
        ImGui::Spacing();

        // Form fields
        ImGui::PushStyleColor(ImGuiCol_Text,           ImVec4(0.75f, 0.75f, 0.75f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBg,        ImVec4(0.13f, 0.13f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.17f, 0.17f, 0.19f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBgActive,  ImVec4(0.20f, 0.20f, 0.22f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);

        ImGui::TextUnformatted("Username");
        ImGui::SetNextItemWidth(w);
        ImGui::InputTextWithHint("##ob_name",  "Your name",
                                 state.full_name, sizeof(state.full_name));

        ImGui::Spacing();
        ImGui::TextUnformatted("Email");
        ImGui::SetNextItemWidth(w);
        ImGui::InputTextWithHint("##ob_email", "you@example.com",
                                 state.email, sizeof(state.email));

        ImGui::Spacing();
        ImGui::TextUnformatted("Password");
        ImGui::SetNextItemWidth(w);
        ImGui::InputTextWithHint("##ob_pw",    "••••••••",
                                 state.password, sizeof(state.password),
                                 ImGuiInputTextFlags_Password);

        ImGui::Spacing();
        ImGui::TextUnformatted("Confirm password");
        ImGui::SetNextItemWidth(w);
        ImGui::InputTextWithHint("##ob_pw2",   "••••••••",
                                 state.confirm_password, sizeof(state.confirm_password),
                                 ImGuiInputTextFlags_Password);

        ImGui::PopStyleVar();
        ImGui::PopStyleColor(4);

        // Error
        if (!state.error_msg.empty()) {
            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.95f, 0.35f, 0.35f, 1.0f));
            ImGui::TextWrapped("%s", state.error_msg.c_str());
            ImGui::PopStyleColor();
        }

        ImGui::Spacing();
        ImGui::Spacing();

        if (state.is_submitting) {
            centered_text("Creating account...", IM_COL32(140, 140, 140, 255));
        } else {
            if (show_primary_button("Create Account", w)) {
                state.handle_register();    // advances to step 3 on success
            }
        }
    }

// ─── Step 3 — Connect a cloud account ────────────────────────────────────────

    void OnboardingPanel::show_step_3_connect(OnboardingState& state) {
        float w = ImGui::GetContentRegionAvail().x;

        // Ensure services state is ready
        auto& svc = registry_.get_state<ServicesState>("Services");
        svc.init(worker_pool_);

        show_progress_dots(3, 4);
        ImGui::Spacing();

        ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
        centered_text("Connect your cloud storage", IM_COL32(240, 240, 240, 255));
        ImGui::PopFont();

        ImGui::Spacing();
        centered_text("Connect an account, or skip for now.", IM_COL32(120, 120, 120, 255));
        ImGui::Spacing();
        ImGui::Spacing();

        // ── Success banner ────────────────────────────────────────────────────
        // Check if any connection was established (after a refresh)
        if (!state.cloud_connected) {
            std::lock_guard<std::mutex> lock(svc.mu);
            if (!svc.connections.empty()) {
                state.cloud_connected    = true;
                state.connected_provider = svc.connections.begin()->display_name.empty()
                    ? svc.connections.begin()->name
                    : svc.connections.begin()->display_name;
            }
        }

        if (state.cloud_connected) {
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.10f, 0.28f, 0.14f, 1.0f));
            if (ImGui::BeginChild("##conn_ok", ImVec2(w, 48.0f), false,
                                  ImGuiWindowFlags_NoScrollbar)) {
                std::string msg = "Connected to " + state.connected_provider + "!";
                float tw = ImGui::CalcTextSize(msg.c_str()).x;
                ImGui::SetCursorPos(ImVec2((w - tw) * 0.5f,
                                          (48.0f - ImGui::GetTextLineHeight()) * 0.5f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.92f, 0.60f, 1.0f));
                ImGui::TextUnformatted(msg.c_str());
                ImGui::PopStyleColor();
            }
            ImGui::EndChild();
            ImGui::PopStyleColor();
            ImGui::Spacing();
        }

        // ── Provider buttons ──────────────────────────────────────────────────
        struct Provider { const char* name; const char* type; const char* icon; };
        static constexpr Provider providers[] = {
            { "OneDrive",     "onedrive", "cloud-24" },
            { "Google Drive", "drive",    "cloud-24" },
            { "Dropbox",      "dropbox",  "cloud-24" },
        };

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,   ImVec2(0.0f, 8.0f));
        ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.14f, 0.14f, 0.16f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.20f, 0.20f, 0.23f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.11f, 0.11f, 0.13f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.85f, 0.85f, 0.85f, 1.0f));

        for (int i = 0; i < 3; ++i) {
            ImGui::PushID(i);
            if (ImGui::Button(providers[i].name, ImVec2(w, 42.0f))) {
                auto now = std::chrono::system_clock::now();
                auto epoch = std::chrono::duration_cast<std::chrono::seconds>(
                    now.time_since_epoch()).count();
                std::string remote_name = std::string(providers[i].type) + "-" + std::to_string(epoch);
                svc.initiate_login(providers[i].type, remote_name);
                state.awaiting_check = true;
            }
            ImGui::PopID();
        }

        ImGui::PopStyleColor(4);
        ImGui::PopStyleVar(2);

        // "Check connection" — appears after user interacts with a provider
        if (state.awaiting_check) {
            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
            ImGui::TextWrapped("Finish signing in via the browser, then click below.");
            ImGui::PopStyleColor();
            ImGui::Spacing();
            if (show_primary_button("Check connection", w)) {
                state.cloud_connected    = false;  // reset so we re-evaluate above
                state.connected_provider = "";
                svc.refresh_connections();
            }
        }

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        // Next / Skip
        if (show_primary_button("Next", w, state.cloud_connected)) {
            state.advance();
        }

        ImGui::Spacing();
        show_ghost_button_link("Skip for now", w);
        if (ImGui::IsItemClicked()) {
            state.advance();
        }
    }

// ─── Step 4 — App tour ───────────────────────────────────────────────────────

    void OnboardingPanel::show_step_4_tour(OnboardingState& state) {
        float w = ImGui::GetContentRegionAvail().x;

        show_progress_dots(4, 4);
        ImGui::Spacing();

        ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
        centered_text("Here's how Misty works", IM_COL32(240, 240, 240, 255));
        ImGui::PopFont();

        ImGui::Spacing();
        ImGui::Spacing();

        // Slide content
        struct Slide { const char* title; const char* caption; };
        static constexpr Slide slides[OnboardingState::TOUR_SLIDE_COUNT] = {
            { "Browse all your files",
              "The sidebar gives you quick access to local folders, cloud services, "
              "and connected devices — all in one place." },
            { "Upload from anywhere",
              "Drag files into any cloud folder or use the New button to upload "
              "directly to OneDrive, Google Drive, or Dropbox." },
            { "Search across clouds",
              "The search bar lets you find files across your local system and "
              "every connected cloud account simultaneously." },
        };

        const Slide& slide = slides[state.tour_slide];

        // Placeholder image slot
        float img_h = 170.0f;
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.11f, 0.11f, 0.13f, 1.0f));
        if (ImGui::BeginChild("##tour_img", ImVec2(w, img_h), false,
                              ImGuiWindowFlags_NoScrollbar)) {
            // Placeholder — swap in real screenshot later
            float text_w = ImGui::CalcTextSize("[ Screenshot coming soon ]").x;
            float text_h = ImGui::GetTextLineHeight();
            ImGui::SetCursorPos(ImVec2((w - text_w) * 0.5f, (img_h - text_h) * 0.5f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.35f, 0.35f, 0.38f, 1.0f));
            ImGui::TextUnformatted("[ Screenshot coming soon ]");
            ImGui::PopStyleColor();
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();

        ImGui::Spacing();

        // Slide title
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.88f, 0.88f, 0.88f, 1.0f));
        float title_w = ImGui::CalcTextSize(slide.title).x;
        ImGui::SetCursorPosX((w - title_w) * 0.5f);
        ImGui::TextUnformatted(slide.title);
        ImGui::PopStyleColor();

        ImGui::Spacing();

        // Caption
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
        ImGui::TextWrapped("%s", slide.caption);
        ImGui::PopStyleColor();

        ImGui::Spacing();

        // Slide dots
        {
            float dot_r   = 3.5f;
            float spacing = 12.0f;
            float tdots   = OnboardingState::TOUR_SLIDE_COUNT * (dot_r * 2.0f)
                          + (OnboardingState::TOUR_SLIDE_COUNT - 1)
                            * (spacing - dot_r * 2.0f);
            float sx = ImGui::GetCursorScreenPos().x + (w - tdots) * 0.5f;
            float sy = ImGui::GetCursorScreenPos().y + dot_r;
            ImDrawList* dl = ImGui::GetWindowDrawList();
            for (int i = 0; i < OnboardingState::TOUR_SLIDE_COUNT; ++i) {
                float cx = sx + i * spacing;
                ImU32 col = (i == state.tour_slide)
                    ? IM_COL32(200, 200, 200, 255)
                    : IM_COL32(60, 60, 60, 255);
                dl->AddCircleFilled(ImVec2(cx, sy), dot_r, col);
            }
            ImGui::Dummy(ImVec2(w, dot_r * 2.0f + 4.0f));
        }

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        // Prev / Next slide or finish
        bool last_slide = (state.tour_slide == OnboardingState::TOUR_SLIDE_COUNT - 1);

        if (state.tour_slide > 0) {
            float half = (w - 8.0f) * 0.5f;
            // Back
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.14f, 0.14f, 0.16f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.20f, 0.20f, 0.23f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.11f, 0.11f, 0.13f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.70f, 0.70f, 0.70f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
            if (ImGui::Button("Back", ImVec2(half, 44.0f))) {
                state.tour_slide--;
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(4);
            ImGui::SameLine(0, 8.0f);
            if (show_primary_button(last_slide ? "Finish" : "Next", half)) {
                if (last_slide) state.advance();
                else            state.tour_slide++;
            }
        } else {
            if (show_primary_button(last_slide ? "Finish" : "Next", w)) {
                if (last_slide) state.advance();
                else            state.tour_slide++;
            }
        }
    }

// ─── Step 5 — Pro upgrade ────────────────────────────────────────────────────

    void OnboardingPanel::show_step_5_pro(OnboardingState& state) {
        float w = ImGui::GetContentRegionAvail().x;

        ImGui::Spacing();

        // Badge
        {
            const char* badge = "  PRO  ";
            float bw = ImGui::CalcTextSize(badge).x + 12.0f;
            ImGui::SetCursorPosX((w - bw) * 0.5f);
            ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.85f, 0.68f, 0.20f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.85f, 0.68f, 0.20f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.85f, 0.68f, 0.20f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.08f, 0.06f, 0.02f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
            ImGui::SmallButton(badge);
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(4);
        }

        ImGui::Spacing();

        ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_LARGE));
        centered_text("Unlock the full experience", IM_COL32(240, 240, 240, 255));
        ImGui::PopFont();

        ImGui::Spacing();
        centered_text("Everything in free, plus:", IM_COL32(120, 120, 120, 255));
        ImGui::Spacing();
        ImGui::Spacing();

        // Feature list
        static const char* features[] = {
            "Unlimited cloud account connections",
            "Priority background sync",
            "Advanced search across all clouds",
            "Scheduled auto-backups",
            "Early access to new features",
        };

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.78f, 0.78f, 0.78f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 8.0f));
        for (const char* feat : features) {
            // Bullet dot
            ImVec2 pos = ImGui::GetCursorScreenPos();
            ImGui::GetWindowDrawList()->AddCircleFilled(
                ImVec2(pos.x + 6.0f, pos.y + ImGui::GetTextLineHeight() * 0.5f),
                3.0f, IM_COL32(160, 160, 160, 200));
            ImGui::SetCursorPosX(ImGui::GetCursorPosX() + 18.0f);
            ImGui::TextUnformatted(feat);
        }
        ImGui::PopStyleVar();
        ImGui::PopStyleColor();

        ImGui::Spacing();
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        // Upgrade button (placeholder — wire up payment later)
        ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.85f, 0.68f, 0.20f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.90f, 0.74f, 0.30f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(0.78f, 0.60f, 0.14f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text,          ImVec4(0.08f, 0.06f, 0.02f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        if (ImGui::Button("Start free trial", ImVec2(w, 44.0f))) {
            // TODO: open billing / payment flow
        }
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(4);

        ImGui::Spacing();

        // "Maybe later" → finish onboarding
        show_ghost_button_link("Maybe later", w);
        if (ImGui::IsItemClicked()) {
            OnboardingState::mark_complete();
            view::switch_view(view::ViewID::Files);
        }
    }

} // namespace misty::panel
