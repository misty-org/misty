#pragma once

#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/claude/claude_process.h"
#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"
#include "panels/panel/panel.h"

namespace misty::panel {

// ── Display model ──────────────────────────────────────────────────────────

struct ClaudeAuthProfile {
    std::string name;
    std::string api_key;
    std::string auth_token;
    std::string base_url;
};

struct ClaudeDisplayMessage {
    enum Type {
        USER,
        ASSISTANT_TEXT,
        TOOL_USE,
        TOOL_RESULT,
        SYSTEM_INFO,
        ERROR,
    };

    Type type;
    std::string content;       // raw content (with markdown)
    std::string tool_name;
    std::string tool_input;
    std::string tool_result;
};

// ── UI state ───────────────────────────────────────────────────────────────

struct ClaudeState : public core::UIState {
    ClaudeState() {
        std::memset(input_buffer, 0, sizeof(input_buffer));
        std::memset(profile_name_buffer, 0, sizeof(profile_name_buffer));
        std::memset(profile_api_key_buffer, 0, sizeof(profile_api_key_buffer));
        std::memset(profile_auth_token_buffer, 0, sizeof(profile_auth_token_buffer));
        std::memset(profile_base_url_buffer, 0, sizeof(profile_base_url_buffer));
    }

    char input_buffer[4096] = "";
    std::string working_dir;
    std::string session_id;
    std::vector<ClaudeDisplayMessage> messages;
    std::string error_msg;
    std::vector<ClaudeAuthProfile> auth_profiles;
    bool profiles_loaded = false;
    bool show_profiles_modal = false;
    int selected_profile_index = -1; // -1 = system/default claude auth
    int editing_profile_index = -1;  // -1 = new profile
    char profile_name_buffer[128] = "";
    char profile_api_key_buffer[256] = "";
    char profile_auth_token_buffer[512] = "";
    char profile_base_url_buffer[256] = "";
    std::string profiles_error_msg;
    bool focus_input = false;
    double total_cost_usd = 0.0;

    std::mutex mu;
    std::unique_ptr<core::ClaudeProcess> process;

    bool is_running() const {
        return process && process->is_running();
    }
};

// ── Panel ──────────────────────────────────────────────────────────────────

class ClaudePanel : public panel::Panel {
public:
    ClaudePanel(core::UIRegistry& registry,
                core::WorkerPool& worker_pool,
                std::string state_key = "Claude");
    ~ClaudePanel() override = default;

    void render() override;

    void set_working_dir(const std::string& dir);
    void toggle() { open_ = !open_; }
    bool is_open() const { return open_; }

private:
    void ensure_profiles_loaded(ClaudeState& state);
    bool save_profiles(const ClaudeState& state, std::string* error = nullptr) const;
    void load_profile_into_editor(ClaudeState& state, int profile_index);
    void clear_profile_editor(ClaudeState& state);
    void apply_profile_selection(ClaudeState& state, int new_index);
    void render_profiles_modal(ClaudeState& state);
    void process_events(ClaudeState& state);
    void submit_message(ClaudeState& state);
    void render_message(int index, const ClaudeDisplayMessage& msg);
    void render_not_installed();
    void new_session(ClaudeState& state);

    core::UIRegistry& registry_;
    core::WorkerPool& worker_pool_;
    std::string state_key_;
    bool open_ = false;
    bool installed_ = false;
    bool install_checked_ = false;
};

} // namespace misty::panel
