#pragma once

#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"
#include "panels/auth/auth_login_panel.h"
#include "panels/onboarding/onboarding_panel.h"

namespace misty::panel {

// BootLoader runs automatically on startup — no user interaction needed for the
// proxy. It scans ports starting at 3000, reuses an already-running proxy or
// launches a new one, then drives the onboarding / login flow.
class BootLoader {
public:
    BootLoader(core::UIRegistry& ui_registry, core::WorkerPool& worker_pool);

    // Call once per frame. Returns true when the full boot flow is complete.
    bool render();

    bool success() const { return success_; }

private:
    enum class Phase {
        Searching,   // auto-scanning ports / launching proxy
        Failed,      // gave up (timeout or no binary)
        Onboarding,  // first-run slideshow + account creation
        Login,       // returning-user login
        Done,        // authenticated — ready to enter the app
    };

    struct ProbeResult {
        int status_code = 0;
        std::string body;
    };

    // Port search
    void        init_port_search();
    int         load_saved_port();
    void        advance_port();
    bool        launch_on_current_port();

    // Proxy helpers
    static std::string misty_config_path();
    static bool        file_exists(const std::string& path);
    static std::string read_text_file(const std::string& path);
    static std::string trim_copy(std::string v);
    static std::string proxy_binary_name();
    static std::string auto_detect_proxy_path();
    bool               ensure_proxy_config_saved(int port);

    // Async HTTP probe
    void begin_probe(const std::string& url);
    bool consume_probe(ProbeResult& out);

    // Auth flow
    void transition_after_proxy_ready();
    void render_onboarding();
    void render_login();

    // State machine + render
    void tick_state_machine();

    // ── Dependencies ────────────────────────────────────────────────────────
    core::UIRegistry& ui_registry_;
    core::WorkerPool& worker_pool_;

    std::unique_ptr<OnboardingPanel> onboarding_panel_;
    std::unique_ptr<AuthLoginPanel>  login_panel_;

    // ── Boot state ──────────────────────────────────────────────────────────
    Phase phase_          = Phase::Searching;
    bool  success_        = false;
    bool  done_           = false;
    bool  from_auth_flow_ = false;

    // ── Port search state ───────────────────────────────────────────────────
    std::vector<int> ports_to_try_;
    int  port_idx_                  = 0;
    int  current_port_              = 3000;
    bool launched_on_current_port_  = false;
    std::string proxy_path_;
    std::string proxy_log_path_;

    // ── Timing ──────────────────────────────────────────────────────────────
    std::chrono::steady_clock::time_point search_start_{};
    std::chrono::steady_clock::time_point port_launch_time_{};
    std::chrono::steady_clock::time_point next_probe_{};
    std::chrono::steady_clock::time_point ready_at_{};

    // ── UI strings ──────────────────────────────────────────────────────────
    std::string status_line_;
    std::string error_line_;

    // ── Async probe ─────────────────────────────────────────────────────────
    std::atomic<bool> probe_in_flight_{false};
    std::mutex        probe_mu_{};
    bool              probe_ready_ = false;
    ProbeResult       last_probe_{};
};

} // namespace misty::panel
