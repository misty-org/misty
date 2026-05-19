#include "panels/onboarding/boot_loader.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

#include "core/manager/font_manager.h"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <cerrno>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

#include "core/manager/session_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"
#include "core/ui/ui_style.h"
#include "panels/onboarding/onboarding_state.h"
#include "imgui.h"

namespace fs = std::filesystem;
using json   = nlohmann::json;

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

constexpr auto kMinimumBootScreenTime = std::chrono::milliseconds(7000);

#ifdef _WIN32
using SocketHandle = SOCKET;
constexpr SocketHandle kInvalidSocket = INVALID_SOCKET;

bool ensure_winsock_ready() {
    static const bool ready = []() {
        WSADATA wsa_data{};
        return WSAStartup(MAKEWORD(2, 2), &wsa_data) == 0;
    }();
    return ready;
}

void close_socket(SocketHandle socket) {
    if (socket != kInvalidSocket) closesocket(socket);
}
#else
using SocketHandle = int;
constexpr SocketHandle kInvalidSocket = -1;

void close_socket(SocketHandle socket) {
    if (socket != kInvalidSocket) close(socket);
}
#endif

bool is_port_occupied(int port) {
    if (port <= 0 || port > 65535) return true;

#ifdef _WIN32
    if (!ensure_winsock_ready()) return true;
#endif

    SocketHandle socket_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (socket_fd == kInvalidSocket) return true;

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<uint16_t>(port));
    addr.sin_addr.s_addr = htonl(INADDR_ANY);

#ifdef _WIN32
    const int addr_len = static_cast<int>(sizeof(addr));
#else
    const socklen_t addr_len = static_cast<socklen_t>(sizeof(addr));
#endif

    const int bind_result = ::bind(
        socket_fd,
        reinterpret_cast<const sockaddr*>(&addr),
        addr_len);
    close_socket(socket_fd);

    if (bind_result == 0) return false;
    return true;
}

float ease_out_cubic(float t) {
    t = std::clamp(t, 0.0f, 1.0f);
    const float inv = 1.0f - t;
    return 1.0f - inv * inv * inv;
}

void draw_sprite_frame(ImDrawList* draw_list, const ImVec2& center, float sprite_size) {
    static constexpr float kLoopSeconds = 1.35f;
    static constexpr int kDotCount = 3;
    const float time = static_cast<float>(ImGui::GetTime());
    const float radius = std::clamp(sprite_size * 0.055f, 4.0f, 8.0f);
    const float gap = radius * 3.1f;
    const float start_x = center.x - gap;

    for (int i = 0; i < kDotCount; ++i) {
        const float phase = std::fmod(time / kLoopSeconds + static_cast<float>(i) / kDotCount, 1.0f);
        const float wave = ease_out_cubic(0.5f + 0.5f * std::sin((phase * 2.0f - 0.5f) * 3.14159265f));
        const float scale = 0.76f + wave * 0.34f;
        const int alpha = static_cast<int>(120.0f + wave * 120.0f);
        const ImVec2 dot_center(
            start_x + static_cast<float>(i) * gap,
            center.y - wave * radius * 0.42f);

        draw_list->AddCircleFilled(
            dot_center,
            radius * scale,
            IM_COL32(232, 234, 238, alpha),
            32);
    }
}

void draw_progress_bar(ImDrawList* draw_list,
                       const ImVec2& min,
                       const ImVec2& max,
                       float progress,
                       ImU32 fill_color) {
    progress = std::clamp(progress, 0.0f, 1.0f);

    draw_list->AddRectFilled(min, max, IM_COL32(255, 255, 255, 18), 999.0f);
    if (progress <= 0.0f) return;

    const ImVec2 fill_max(min.x + (max.x - min.x) * progress, max.y);
    draw_list->AddRectFilled(min, fill_max, fill_color, 999.0f);

    const float shimmer_w = std::min(26.0f, fill_max.x - min.x);
    if (shimmer_w > 2.0f) {
        draw_list->AddRectFilledMultiColor(
            ImVec2(fill_max.x - shimmer_w, min.y),
            fill_max,
            IM_COL32(255, 255, 255, 0),
            IM_COL32(255, 255, 255, 110),
            IM_COL32(255, 255, 255, 110),
            IM_COL32(255, 255, 255, 0));
    }
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
    const fs::path exe_dir = misty::core::get_executable_path().parent_path();
    const std::string name = proxy_binary_name();

    // 1) Next to / near executable
    for (const auto& c : {
            exe_dir / name,
            exe_dir / "proxy" / name,
            exe_dir.parent_path() / "proxy" / name,
            fs::current_path() / "proxy" / name }) {
        if (!c.empty() && fs::exists(c)) return c.string();
    }

    // 2) Walk up from exe dir or cwd (dev builds)
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

// ── Port search ──────────────────────────────────────────────────────────────

int BootLoader::load_saved_proxy_port() {
    try {
        const std::string body = read_text_file(misty_config_path());
        if (!body.empty()) {
            json j = json::parse(body, nullptr, false);
            if (!j.is_discarded()) {
                const json proxy = j.value("proxy", json::object());
                const int proxy_port = proxy.value("port", 0);
                if (proxy_port > 0 && proxy_port <= 65535) {
                    return proxy_port;
                }
            }
        }
    } catch (...) {}
    return 3000;
}

void BootLoader::init_port_search() {
    ports_to_try_.clear();
    const int saved_port = load_saved_proxy_port();
    if (saved_port > 0) {
        ports_to_try_.push_back(saved_port);
    }
    for (int p = 3000; p <= 3020; ++p) {
        if (p != saved_port) {
            ports_to_try_.push_back(p);
        }
    }

    port_idx_                 = 0;
    current_port_             = ports_to_try_[0];
    launched_on_current_port_ = false;
    proxy_ready_              = false;
    search_step_              = SearchStep::CheckPort;
    search_start_             = std::chrono::steady_clock::now();
    boot_started_at_          = search_start_;
    next_probe_               = search_start_;   // probe immediately
    status_line_              = "Looking for background service...";
    error_line_.clear();
    { std::scoped_lock lk(probe_mu_); probe_ready_ = false; }
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
    search_step_              = SearchStep::CheckPort;
    { std::scoped_lock lk(probe_mu_); probe_ready_ = false; }
    status_line_ = "Trying port " + std::to_string(current_port_) + "...";
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

    status_line_ = "Starting background service...";

    return misty::core::launch_detached_process(
        proxy_path_,
        {},
        fs::path(proxy_path_).parent_path().string(),
        proxy_log_path_,
        proxy_log_path_);
}

// ── Async probe ───────────────────────────────────────────────────────────────

void BootLoader::begin_probe(const std::string& base_url) {
    bool expected = false;
    if (!probe_in_flight_.compare_exchange_strong(expected, true)) return;

    struct Shared { int status = 0; std::string body; };
    auto shared = std::make_shared<Shared>();

    worker_pool_.add(
        [base_url, shared]() {
            auto ready = misty::core::HTTPClient::get().get(
                base_url + "/api/health",
                {.timeouts = {1L, 2L}});
            shared->status = ready.status_code;
            shared->body   = std::move(ready.body);
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

void BootLoader::mark_proxy_ready() {
    proxy_ready_ = true;
    status_line_ = "Background service ready. Finalizing startup...";

    if (std::chrono::steady_clock::now() - boot_started_at_ >= kMinimumBootScreenTime) {
        proxy_ready_ = false;
        transition_after_proxy_ready();
    }
}

void BootLoader::transition_after_proxy_ready() {
    auto& session = core::SessionManager::get();
    if (session.is_authenticated() || session.bootstrap_session()) {
        success_  = true;
        phase_    = Phase::Done;
        ready_at_ = std::chrono::steady_clock::now();
    } else if (panel::OnboardingState::is_complete()) {
        phase_ = Phase::Login;
    } else {
        phase_ = Phase::Onboarding;
    }
}

float BootLoader::loading_progress() const {
    const float minimum_seconds =
        std::chrono::duration<float>(kMinimumBootScreenTime).count();
    const float elapsed_seconds =
        std::chrono::duration<float>(std::chrono::steady_clock::now() - boot_started_at_).count();

    if (minimum_seconds <= 0.0f) return 1.0f;

    if (elapsed_seconds <= minimum_seconds) {
        const float ratio = elapsed_seconds / minimum_seconds;
        return 0.08f + 0.80f * ease_out_cubic(ratio);
    }

    const float tail_seconds = elapsed_seconds - minimum_seconds;
    return std::min(0.98f, 0.88f + 0.10f * (1.0f - std::exp(-tail_seconds * 0.85f)));
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
    constexpr auto kLaunchReadyTimeout = std::chrono::seconds(5);
    constexpr auto kSearchTimeout = std::chrono::seconds(20);

    if (proxy_ready_) {
        if (now - boot_started_at_ >= kMinimumBootScreenTime) {
            proxy_ready_ = false;
            transition_after_proxy_ready();
        }
        return;
    }

    // Overall search deadline
    if (now - search_start_ > kSearchTimeout) {
        error_line_ = "Could not start the background service within 20 seconds. "
                      "Check ~/misty/.cache/misty-proxy.log for details.";
        phase_ = Phase::Failed;
        return;
    }

    // Wait for any in-flight probe
    if (probe_in_flight_.load()) return;

    ProbeResult probe{};
    const bool has_probe_result = consume_probe(probe);
    const std::string base_url = "http://127.0.0.1:" + std::to_string(current_port_);

    if (search_step_ == SearchStep::CheckPort) {
        if (is_port_occupied(current_port_)) {
            status_line_ = "Port " + std::to_string(current_port_) + " is in use. Checking service...";
            search_step_ = SearchStep::ProbeExistingProxy;
            next_probe_ = now + std::chrono::milliseconds(50);
        } else {
            if (!launch_on_current_port()) {
                advance_port();
                return;
            }
            launched_on_current_port_ = true;
            port_launch_time_ = now;
            search_step_ = SearchStep::WaitForLaunchedProxy;
            next_probe_ = now + std::chrono::milliseconds(400);
            return;
        }
    }

    if (search_step_ == SearchStep::ProbeExistingProxy) {
        if (has_probe_result) {
            if (probe.status_code >= 200 && probe.status_code < 300) {
                mark_proxy_ready();
            } else {
                advance_port();
            }
            return;
        }

        if (now < next_probe_) return;
        next_probe_ = now + std::chrono::milliseconds(250);
        begin_probe(base_url);
        return;
    }

    if (search_step_ == SearchStep::WaitForLaunchedProxy) {
        if (now - port_launch_time_ > kLaunchReadyTimeout) {
            advance_port();
            return;
        }

        if (has_probe_result && probe.status_code >= 200 && probe.status_code < 300) {
            mark_proxy_ready();
            return;
        }

        if (now < next_probe_) return;
        next_probe_ = now + std::chrono::milliseconds(250);
        begin_probe(base_url);
    }
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

    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.031f, 0.039f, 0.055f, 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,   ImVec2(0.0f, 12.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,  ImVec2(12.0f, 10.0f));

    const bool open = ImGui::Begin("Misty Boot", nullptr, kFlags);
    if (!open) {
        ImGui::End(); ImGui::PopStyleVar(3); ImGui::PopStyleColor();
        return false;
    }

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const ImVec2 win_min = ImGui::GetWindowPos();
    const ImVec2 win_max(win_min.x + ImGui::GetWindowSize().x, win_min.y + ImGui::GetWindowSize().y);

    draw_list->AddRectFilledMultiColor(
        win_min,
        win_max,
        IM_COL32(9, 10, 16, 255),
        IM_COL32(12, 16, 24, 255),
        IM_COL32(18, 24, 36, 255),
        IM_COL32(10, 10, 18, 255));
    draw_list->AddCircleFilled(
        ImVec2(win_min.x + 120.0f, win_min.y + 140.0f),
        180.0f,
        IM_COL32(34, 197, 94, 16),
        96);
    draw_list->AddCircleFilled(
        ImVec2(win_max.x - 120.0f, win_min.y + 120.0f),
        220.0f,
        IM_COL32(59, 130, 246, 22),
        96);

    const float card_w = std::max(320.0f, std::min(460.0f, vp->WorkSize.x - 48.0f));
    const float card_h = (phase_ == Phase::Failed) ? 410.0f : 360.0f;
    const ImVec2 card_min(
        vp->WorkPos.x + (vp->WorkSize.x - card_w) * 0.5f,
        vp->WorkPos.y + (vp->WorkSize.y - card_h) * 0.5f);
    const ImVec2 card_max(card_min.x + card_w, card_min.y + card_h);
    const ImVec2 content_min(card_min.x + 32.0f, card_min.y + 28.0f);
    const float content_w = card_w - 64.0f;

    draw_list->AddRectFilled(card_min, card_max, IM_COL32(15, 18, 26, 235), 28.0f);
    draw_list->AddRect(
        card_min,
        card_max,
        IM_COL32(255, 255, 255, 18),
        28.0f,
        0,
        1.0f);

    ImGui::SetCursorScreenPos(content_min);
    ImGui::BeginGroup();

    const float group_start_x = ImGui::GetCursorPosX();
    ImGui::Dummy(ImVec2(content_w, 164.0f));
    draw_sprite_frame(
        draw_list,
        ImVec2(card_min.x + card_w * 0.5f, card_min.y + 108.0f),
        132.0f);

    const char* title = "Starting Misty";
    std::string subtitle = "Booting local services, checking ports, and preparing your session.";
    if (proxy_ready_) {
        subtitle = "Services are online. Finishing startup before handing off to the app.";
    } else if (phase_ == Phase::Done) {
        subtitle = "Everything is ready. Entering your workspace.";
    } else if (phase_ == Phase::Failed) {
        title = "Startup needs attention";
        subtitle = "The local background service did not come up cleanly.";
    }

    ImGui::PushFont(core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD_LARGE));
    const float title_w = ImGui::CalcTextSize(title).x;
    ImGui::SetCursorPosX(group_start_x + std::max(0.0f, (content_w - title_w) * 0.5f));
    ImGui::TextUnformatted(title);
    ImGui::PopFont();

    ImGui::Dummy(ImVec2(0.0f, 8.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.73f, 0.78f, 0.86f, 0.95f));
    ImGui::PushTextWrapPos(group_start_x + content_w);
    ImGui::TextWrapped("%s", subtitle.c_str());
    ImGui::PopTextWrapPos();
    ImGui::PopStyleColor();

    ImGui::Dummy(ImVec2(0.0f, 14.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.86f, 0.89f, 0.94f, 1.0f));
    ImGui::PushTextWrapPos(group_start_x + content_w);
    ImGui::TextWrapped("%s", status_line_.c_str());
    ImGui::PopTextWrapPos();
    ImGui::PopStyleColor();

    if (!error_line_.empty()) {
        ImGui::Dummy(ImVec2(0.0f, 10.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.95f, 0.50f, 0.50f, 1.0f));
        ImGui::PushTextWrapPos(group_start_x + content_w);
        ImGui::TextWrapped("%s", error_line_.c_str());
        ImGui::PopTextWrapPos();
        ImGui::PopStyleColor();
    }

    ImGui::Dummy(ImVec2(0.0f, 18.0f));
    const ImVec2 bar_min = ImGui::GetCursorScreenPos();
    const float progress = (phase_ == Phase::Failed) ? 1.0f
        : (phase_ == Phase::Done ? 1.0f : loading_progress());
    const ImU32 progress_color = (phase_ == Phase::Failed)
        ? IM_COL32(234, 88, 88, 255)
        : IM_COL32(59, 130, 246, 255);
    ImGui::Dummy(ImVec2(content_w, 6.0f));
    draw_progress_bar(
        draw_list,
        bar_min,
        ImVec2(bar_min.x + content_w, bar_min.y + 4.0f),
        progress,
        progress_color);

    ImGui::Dummy(ImVec2(0.0f, 16.0f));

    if (phase_ == Phase::Searching) {
        if (!proxy_log_path_.empty() && file_exists(proxy_log_path_)) {
            const ImVec2 button_size(90.0f, 30.0f);
            ImGui::SetCursorPosX(group_start_x + std::max(0.0f, (content_w - button_size.x) * 0.5f));
            if (ImGui::Button("Open log", button_size)) {
                misty::core::open_path_default(proxy_log_path_);
            }
        }

    } else if (phase_ == Phase::Failed) {
        const ImVec2 retry_size(118.0f, 42.0f);
        const ImVec2 log_size(90.0f, 42.0f);
        const ImVec2 quit_size(88.0f, 42.0f);
        const bool show_log = !proxy_log_path_.empty() && file_exists(proxy_log_path_);
        const float total_w = retry_size.x + quit_size.x + 12.0f + (show_log ? (log_size.x + 12.0f) : 0.0f);
        ImGui::SetCursorPosX(group_start_x + std::max(0.0f, (content_w - total_w) * 0.5f));

        if (styled_button("Retry", retry_size, primary_button_style())) {
            proxy_path_ = auto_detect_proxy_path();
            init_port_search();
            phase_ = Phase::Searching;
        }

        if (show_log) {
            ImGui::SameLine(0.0f, 12.0f);
            if (ImGui::Button("Open log", log_size)) {
                misty::core::open_path_default(proxy_log_path_);
            }
        }

        ImGui::SameLine(0.0f, 12.0f);
        if (ImGui::Button("Quit", quit_size)) {
            done_ = true;
        }

    } else if (phase_ == Phase::Done) {
        if (ready_at_.time_since_epoch().count() != 0 &&
            std::chrono::steady_clock::now() - ready_at_ > std::chrono::milliseconds(150)) {
            done_ = true;
        }
    }

    ImGui::EndGroup();

    ImGui::End();
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor();

    return done_;
}

} // namespace misty::panel
