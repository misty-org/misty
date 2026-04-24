#include "panels/onboarding/boot_loader.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

#include "core/manager/asset_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"
#include "core/ui/imgui_utils.h"
#include "panels/onboarding/onboarding_state.h"
#include "imgui.h"

namespace fs = std::filesystem;
using json   = nlohmann::json;

namespace misty::panel {

namespace {

void centered_title(const char* text) {
    const float w  = ImGui::GetContentRegionAvail().x;
    const float tw = ImGui::CalcTextSize(text).x;
    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + (w - tw) * 0.5f);
    ImGui::TextUnformatted(text);
}

bool save_json_atomic(const std::string& path, const json& j) {
    if (path.empty()) return false;
    std::error_code ec;
    fs::create_directories(fs::path(path).parent_path(), ec);
    const std::string tmp = path + ".tmp";
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f.is_open()) return false;
        f << j.dump(2) << "\n";
        if (!f.good()) return false;
    }
    fs::rename(fs::path(tmp), fs::path(path), ec);
    if (ec) { fs::remove(fs::path(tmp), ec); return false; }
    return true;
}

} // namespace

// ── Construction ─────────────────────────────────────────────────────────────

BootLoader::BootLoader(core::UIRegistry& ui_registry, core::WorkerPool& worker_pool)
    : ui_registry_(ui_registry), worker_pool_(worker_pool)
{
    if (const char* home = std::getenv("HOME"); home && *home) {
        proxy_log_path_ = (fs::path(home) / "misty" / ".cache" / "misty-proxy.log").string();
    }
    proxy_path_ = auto_detect_proxy_path();
    init_port_search();
}

// ── Static helpers ───────────────────────────────────────────────────────────

std::string BootLoader::misty_config_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') return {};
    return (fs::path(home) / "misty" / "config" / "misty.json").string();
}

bool BootLoader::file_exists(const std::string& path) {
    if (path.empty()) return false;
    std::error_code ec;
    return fs::exists(fs::path(path), ec);
}

std::string BootLoader::read_text_file(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) return {};
    return {std::istreambuf_iterator<char>(f), {}};
}

std::string BootLoader::trim_copy(std::string v) {
    auto not_space = [](unsigned char c) { return !std::isspace(c); };
    v.erase(v.begin(), std::find_if(v.begin(), v.end(), not_space));
    v.erase(std::find_if(v.rbegin(), v.rend(), not_space).base(), v.end());
    return v;
}

std::string BootLoader::proxy_binary_name() {
#ifdef _WIN32
    return "misty-proxy.exe";
#else
    return "misty-proxy";
#endif
}

std::string BootLoader::auto_detect_proxy_path() {
    // 1) Config-specified path
    try {
        const std::string cfg = misty_config_path();
        if (file_exists(cfg)) {
            const std::string body = read_text_file(cfg);
            if (!body.empty()) {
                json j = json::parse(body, nullptr, false);
                if (!j.is_discarded()) {
                    const std::string p = trim_copy(
                        j.value("proxy", json::object()).value("path", std::string()));
                    if (!p.empty() && file_exists(p)) return p;
                }
            }
        }
    } catch (...) {}

    const fs::path exe_dir = misty::core::get_executable_path().parent_path();
    const std::string name = proxy_binary_name();

    // 2) Next to / near executable
    for (const auto& c : {
            exe_dir / name,
            exe_dir / "proxy" / name,
            exe_dir.parent_path() / "proxy" / name,
            fs::current_path() / "proxy" / name }) {
        if (!c.empty() && fs::exists(c)) return c.string();
    }

    // 3) Walk up from exe dir or cwd (dev builds)
    for (fs::path cur : {exe_dir, fs::current_path()}) {
        for (int i = 0; i < 6; ++i) {
            const fs::path c = cur / "proxy" / "dist" / name;
            if (fs::exists(c)) return c.string();
            if (!cur.has_parent_path()) break;
            cur = cur.parent_path();
        }
    }
    return {};
}

bool BootLoader::ensure_proxy_config_saved(int port) {
    const std::string cfg = misty_config_path();
    if (cfg.empty() || port <= 0 || port > 65535) return false;

    json j = json::object();
    try {
        if (file_exists(cfg)) {
            const std::string body = read_text_file(cfg);
            if (!body.empty()) {
                json parsed = json::parse(body, nullptr, false);
                if (!parsed.is_discarded() && parsed.is_object()) j = std::move(parsed);
            }
        }
    } catch (...) {}

    j["proxy"]["port"] = port;
    j["proxy"]["url"]  = "http://127.0.0.1:" + std::to_string(port);
    return save_json_atomic(cfg, j);
}

// ── Port search ──────────────────────────────────────────────────────────────

int BootLoader::load_saved_port() {
    try {
        const std::string body = read_text_file(misty_config_path());
        if (!body.empty()) {
            json j = json::parse(body, nullptr, false);
            if (!j.is_discarded()) {
                int p = j.value("proxy", json::object()).value("port", 0);
                if (p > 0 && p <= 65535) return p;
            }
        }
    } catch (...) {}
    return 3000;
}

void BootLoader::init_port_search() {
    ports_to_try_.clear();
    const int saved = load_saved_port();

    // Try saved port first (might already be running), then 3000 onwards.
    if (saved != 3000) ports_to_try_.push_back(saved);
    for (int p = 3000; p <= 3020; ++p) {
        if (p != saved) ports_to_try_.push_back(p);
    }

    port_idx_                 = 0;
    current_port_             = ports_to_try_[0];
    launched_on_current_port_ = false;
    search_start_             = std::chrono::steady_clock::now();
    next_probe_               = search_start_;   // probe immediately
    status_line_              = "Looking for background service\xe2\x80\xa6";
    error_line_.clear();
}

void BootLoader::advance_port() {
    ++port_idx_;
    if (port_idx_ >= static_cast<int>(ports_to_try_.size())) {
        error_line_ = "Could not start the background service. "
                      "Check ~/misty/.cache/misty-proxy.log for details.";
        phase_ = Phase::Failed;
        return;
    }
    current_port_             = ports_to_try_[port_idx_];
    launched_on_current_port_ = false;
    { std::scoped_lock lk(probe_mu_); probe_ready_ = false; }
    status_line_ = "Trying port " + std::to_string(current_port_) + "\xe2\x80\xa6";
    next_probe_  = std::chrono::steady_clock::now() + std::chrono::milliseconds(50);
}

bool BootLoader::launch_on_current_port() {
    if (proxy_path_.empty() || !file_exists(proxy_path_)) {
        proxy_path_ = auto_detect_proxy_path();
    }
    if (proxy_path_.empty() || !file_exists(proxy_path_)) {
        // No binary — can't launch, but still probe other ports in case
        // something external is running.
        return false;
    }

    if (!proxy_log_path_.empty()) {
        std::error_code ec;
        fs::create_directories(fs::path(proxy_log_path_).parent_path(), ec);
        std::ofstream{proxy_log_path_, std::ios::app};   // touch
    }

    status_line_ = "Starting background service on port "
                 + std::to_string(current_port_) + "\xe2\x80\xa6";

    return misty::core::launch_detached_process(
        proxy_path_,
        {"--port", std::to_string(current_port_)},
        fs::path(proxy_path_).parent_path().string(),
        proxy_log_path_,
        proxy_log_path_);
}

// ── Async probe ───────────────────────────────────────────────────────────────

void BootLoader::begin_probe(const std::string& url) {
    bool expected = false;
    if (!probe_in_flight_.compare_exchange_strong(expected, true)) return;

    struct Shared { int status = 0; std::string body; };
    auto shared = std::make_shared<Shared>();

    worker_pool_.add(
        [url, shared]() {
            auto r = misty::core::HTTPClient::get().get_with_timeouts(url, 1L, 2L);
            shared->status = r.status_code;
            shared->body   = std::move(r.body);
        },
        [this, shared]() {
            { std::scoped_lock lk(probe_mu_);
              last_probe_ = {shared->status, std::move(shared->body)};
              probe_ready_ = true; }
            probe_in_flight_.store(false);
        },
        [this](const std::string& err) {
            { std::scoped_lock lk(probe_mu_);
              last_probe_ = {0, err};
              probe_ready_ = true; }
            probe_in_flight_.store(false);
        });
}

bool BootLoader::consume_probe(ProbeResult& out) {
    std::scoped_lock lk(probe_mu_);
    if (!probe_ready_) return false;
    out = last_probe_;
    probe_ready_ = false;
    return true;
}

// ── Auth flow ─────────────────────────────────────────────────────────────────

void BootLoader::transition_after_proxy_ready() {
    if (core::SessionManager::get().is_authenticated()) {
        success_  = true;
        phase_    = Phase::Done;
        ready_at_ = std::chrono::steady_clock::now();
    } else if (panel::OnboardingState::is_complete()) {
        phase_ = Phase::Login;
    } else {
        phase_ = Phase::Onboarding;
    }
}

void BootLoader::render_onboarding() {
    if (!onboarding_panel_)
        onboarding_panel_ = std::make_unique<OnboardingPanel>(ui_registry_, worker_pool_);

    auto& state = ui_registry_.get_state<OnboardingState>("Onboarding");
    constexpr float heights[] = {400.0f, 580.0f, 560.0f, 520.0f, 540.0f, 500.0f};
    float h = (state.step >= 0 && state.step < 6) ? heights[state.step] : 500.0f;

    ImGuiViewport* vp = ImGui::GetMainViewport();
    constexpr float w = 500.0f;
    ImGui::SetNextWindowPos(
        ImVec2(vp->WorkPos.x + (vp->WorkSize.x - w) * 0.5f,
               vp->WorkPos.y + (vp->WorkSize.y - h) * 0.5f), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(w, h), ImGuiCond_Always);
    ImGui::SetNextWindowViewport(vp->ID);
    onboarding_panel_->render();
}

void BootLoader::render_login() {
    if (!login_panel_)
        login_panel_ = std::make_unique<AuthLoginPanel>(ui_registry_);

    ImGuiViewport* vp = ImGui::GetMainViewport();
    constexpr float w = 480.0f, h = 520.0f;
    ImGui::SetNextWindowPos(
        ImVec2(vp->WorkPos.x + (vp->WorkSize.x - w) * 0.5f,
               vp->WorkPos.y + (vp->WorkSize.y - h) * 0.5f), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(w, h), ImGuiCond_Always);
    ImGui::SetNextWindowViewport(vp->ID);
    login_panel_->render();
}

// ── State machine ─────────────────────────────────────────────────────────────

void BootLoader::tick_state_machine() {
    // ── Auth phases ───────────────────────────────────────────────────────────
    if (phase_ == Phase::Onboarding) {
        auto& ob = ui_registry_.get_state<OnboardingState>("Onboarding");
        if (core::SessionManager::get().is_authenticated()) {
            ob.go_to_login  = false;
            success_        = true;
            phase_          = Phase::Done;
            from_auth_flow_ = true;
            ready_at_       = std::chrono::steady_clock::now();
        } else if (ob.go_to_login) {
            ob.go_to_login = false;
            phase_         = Phase::Login;
        }
        return;
    }

    if (phase_ == Phase::Login) {
        if (core::SessionManager::get().is_authenticated()) {
            success_        = true;
            phase_          = Phase::Done;
            from_auth_flow_ = true;
            ready_at_       = std::chrono::steady_clock::now();
        }
        return;
    }

    if (phase_ != Phase::Searching) return;

    // ── Proxy search ──────────────────────────────────────────────────────────
    const auto now = std::chrono::steady_clock::now();

    // Global 5-second deadline
    if (now - search_start_ > std::chrono::seconds(5)) {
        error_line_ = "Could not start the background service within 5 seconds. "
                      "Check ~/misty/.cache/misty-proxy.log for details.";
        phase_ = Phase::Failed;
        return;
    }

    // Wait for any in-flight probe
    if (probe_in_flight_.load()) return;

    // Per-port timeout: give up on a launched port after 1.5 s
    if (launched_on_current_port_ &&
        now - port_launch_time_ > std::chrono::milliseconds(1500)) {
        advance_port();
        return;
    }

    // Rate-limit probes
    if (now < next_probe_) return;
    next_probe_ = now + std::chrono::milliseconds(250);

    // Consume any available probe result
    ProbeResult probe{};
    if (consume_probe(probe)) {
        if (probe.status_code >= 200 && probe.status_code < 300) {
            // Found a working proxy on current_port_!
            ensure_proxy_config_saved(current_port_);
            status_line_ = "Background service ready.";
            transition_after_proxy_ready();
            return;
        }

        // Port not responding
        if (!launched_on_current_port_) {
            // Nothing running here — try to launch
            if (launch_on_current_port()) {
                launched_on_current_port_ = true;
                port_launch_time_         = now;
                // Give the process a moment before probing again
                next_probe_ = now + std::chrono::milliseconds(400);
            } else {
                // No binary or launch failed — skip this port
                advance_port();
            }
            return;
        }
        // Already launched, still not responding — keep probing (rate-limited above)
    }

    // Kick off next probe
    const std::string url = "http://127.0.0.1:" + std::to_string(current_port_) + "/api/hello";
    begin_probe(url);
}

// ── Render ────────────────────────────────────────────────────────────────────

bool BootLoader::render() {
    tick_state_machine();

    // Auth phases render their own panels
    if (phase_ == Phase::Onboarding) { render_onboarding(); return false; }
    if (phase_ == Phase::Login)      { render_login();       return false; }
    if (phase_ == Phase::Done && from_auth_flow_) { done_ = true; return true; }

    // ── Proxy / loading chrome ────────────────────────────────────────────────
    constexpr ImGuiWindowFlags kFlags =
        ImGuiWindowFlags_NoTitleBar  | ImGuiWindowFlags_NoResize  |
        ImGuiWindowFlags_NoMove      | ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoDocking;

    ImGuiViewport* vp = ImGui::GetMainViewport();
    ImGui::SetNextWindowViewport(vp->ID);
    ImGui::SetNextWindowPos(vp->WorkPos,  ImGuiCond_Always);
    ImGui::SetNextWindowSize(vp->WorkSize, ImGuiCond_Always);

    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.067f, 0.067f, 0.075f, 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(40.0f, 36.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,   ImVec2(0.0f,  12.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,  ImVec2(12.0f, 10.0f));

    const bool open = ImGui::Begin("Misty Boot", nullptr, kFlags);
    if (!open) {
        ImGui::End(); ImGui::PopStyleVar(3); ImGui::PopStyleColor();
        return false;
    }

    const float w = ImGui::GetContentRegionAvail().x;

    // Brand icon
    auto& icon = core::AssetManager::get().get_svg_texture("cloud-24", 40);
    if (icon.id) {
        ImGui::SetCursorPosX((w - 40.0f) * 0.5f);
        ImGui::Image(icon.id, ImVec2(40.0f, 40.0f));
        ImGui::Spacing();
    }

    ImGui::PushFont(core::AssetManager::get().get_font(core::FontID::ROBOTO_BOLD_LARGE));
    centered_title("Starting Misty");
    ImGui::PopFont();
    ImGui::Spacing();

    // Status / error
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.72f, 0.72f, 0.72f, 1.0f));
    ImGui::TextWrapped("%s", status_line_.c_str());
    ImGui::PopStyleColor();

    if (!error_line_.empty()) {
        ImGui::Spacing();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.44f, 0.44f, 1.0f));
        ImGui::TextWrapped("%s", error_line_.c_str());
        ImGui::PopStyleColor();
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    if (phase_ == Phase::Searching) {
        // Animated progress bar — no buttons, nothing to click
        ImGui::ProgressBar(-1.0f, ImVec2(-1.0f, 0.0f));

        if (!proxy_log_path_.empty() && file_exists(proxy_log_path_)) {
            ImGui::Spacing();
            if (ImGui::Button("Open log"))
                misty::core::open_path_default(proxy_log_path_);
        }

    } else if (phase_ == Phase::Failed) {
        if (core::StyledButton("Retry", ImVec2(120.0f, 44.0f), core::ButtonTheme::Primary())) {
            // Reset to port 3000 and try again
            proxy_path_ = auto_detect_proxy_path();
            init_port_search();
            phase_ = Phase::Searching;
        }
        if (!proxy_log_path_.empty() && file_exists(proxy_log_path_)) {
            ImGui::SameLine(0.0f, 12.0f);
            if (ImGui::Button("Open log"))
                misty::core::open_path_default(proxy_log_path_);
        }
        ImGui::SameLine(0.0f, 12.0f);
        if (ImGui::Button("Quit"))
            done_ = true;   // success_ stays false → Application shuts down

    } else if (phase_ == Phase::Done) {
        // Already-authenticated fast path: proxy was running, user was logged in
        if (ready_at_.time_since_epoch().count() != 0 &&
            std::chrono::steady_clock::now() - ready_at_ > std::chrono::milliseconds(150)) {
            done_ = true;
        }
    }

    ImGui::End();
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor();

    return done_;
}

} // namespace misty::panel
