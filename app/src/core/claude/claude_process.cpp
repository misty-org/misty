#include "core/claude/claude_process.h"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <nlohmann/json.hpp>

#ifndef _WIN32
extern char** environ;
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace misty::core {

using json = nlohmann::json;

namespace {

/// Resolve the full path to `claude` via `which`.
/// GUI apps on macOS don't inherit the shell PATH, so execvp("claude")
/// may fail even though `claude` works in a terminal.  We also try
/// the common install location as a fallback.
std::string resolve_claude_path() {
#ifndef _WIN32
    // Try `which` first (works if launched from terminal or PATH is set)
    FILE* fp = popen("/bin/sh -c 'which claude 2>/dev/null'", "r");
    if (fp) {
        std::array<char, 512> buf;
        std::string result;
        while (fgets(buf.data(), buf.size(), fp)) {
            result += buf.data();
        }
        pclose(fp);
        while (!result.empty() && (result.back() == '\n' || result.back() == '\r'))
            result.pop_back();
        if (!result.empty()) return result;
    }

    // Fallback: common install locations
    const char* home = getenv("HOME");
    if (home) {
        std::string local_bin = std::string(home) + "/.local/bin/claude";
        if (access(local_bin.c_str(), X_OK) == 0) return local_bin;
    }
#endif
    return "claude"; // last resort — let execvp try PATH
}

} // namespace

ClaudeProcess::~ClaudeProcess() {
    abort();
}

bool ClaudeProcess::is_installed() {
#ifdef _WIN32
    return std::system("where claude >nul 2>nul") == 0;
#else
    return !resolve_claude_path().empty();
#endif
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

bool ClaudeProcess::send_message(const std::string& prompt,
                                  const std::string& cwd,
                                  const std::string& session_id,
                                  const std::map<std::string, std::string>& env_overrides) {
    if (running_.load()) return false;

    if (reader_thread_.joinable()) {
        reader_thread_.join();
    }

#ifndef _WIN32
    int pipefd[2];
    if (pipe(pipefd) != 0) return false;

    pid_t pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        return false;
    }

    if (pid == 0) {
        // ── Child ──
        close(pipefd[0]);
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);

        if (!cwd.empty()) {
            if (chdir(cwd.c_str()) != 0) _exit(126);
        }

        // Resolve full path before exec — GUI apps may lack shell PATH
        std::string claude_bin = resolve_claude_path();

        std::vector<const char*> args;
        args.push_back(claude_bin.c_str());
        args.push_back("-p");
        args.push_back(prompt.c_str());
        args.push_back("--output-format");
        args.push_back("stream-json");
        args.push_back("--verbose");

        std::string sid_copy = session_id;
        if (!sid_copy.empty()) {
            args.push_back("--resume");
            args.push_back(sid_copy.c_str());
        }

        args.push_back(nullptr);

        std::map<std::string, std::string> env_map;
        if (environ != nullptr) {
            for (char** env = environ; *env != nullptr; ++env) {
                std::string entry(*env);
                const size_t eq = entry.find('=');
                if (eq == std::string::npos) {
                    continue;
                }
                env_map[entry.substr(0, eq)] = entry.substr(eq + 1);
            }
        }
        for (const auto& [key, value] : env_overrides) {
            if (value.empty()) {
                env_map.erase(key);
            } else {
                env_map[key] = value;
            }
        }

        std::vector<std::string> env_storage;
        env_storage.reserve(env_map.size());
        std::vector<char*> envp;
        envp.reserve(env_map.size() + 1);
        for (const auto& [key, value] : env_map) {
            env_storage.push_back(key + "=" + value);
        }
        for (auto& entry : env_storage) {
            envp.push_back(entry.data());
        }
        envp.push_back(nullptr);

        execve(claude_bin.c_str(), const_cast<char* const*>(args.data()), envp.data());
        _exit(127);
    }

    // ── Parent ──
    close(pipefd[1]);

    {
        std::lock_guard<std::mutex> lock(mu_);
        child_pid_ = pid;
    }
    running_.store(true);

    reader_thread_ = std::thread(&ClaudeProcess::reader_loop, this, pipefd[0]);
    return true;
#else
    return false;
#endif
}

std::vector<ClaudeEvent> ClaudeProcess::drain_events() {
    std::lock_guard<std::mutex> lock(mu_);
    std::vector<ClaudeEvent> out;
    out.swap(pending_events_);
    return out;
}

void ClaudeProcess::abort() {
#ifndef _WIN32
    {
        std::lock_guard<std::mutex> lock(mu_);
        if (child_pid_ > 0 && running_.load()) {
            kill(child_pid_, SIGTERM);
        }
    }
#endif
    if (reader_thread_.joinable()) {
        reader_thread_.join();
    }
    running_.store(false);

    std::lock_guard<std::mutex> lock(mu_);
    child_pid_ = -1;
}

std::string ClaudeProcess::session_id() const {
    std::lock_guard<std::mutex> lock(mu_);
    return session_id_;
}

// ── Reader thread ──────────────────────────────────────────────────────────

#ifndef _WIN32
void ClaudeProcess::reader_loop(int fd) {
    std::string buffer;
    char chunk[4096];

    while (true) {
        ssize_t n = read(fd, chunk, sizeof(chunk) - 1);
        if (n <= 0) break;

        buffer.append(chunk, static_cast<size_t>(n));

        size_t pos;
        while ((pos = buffer.find('\n')) != std::string::npos) {
            std::string line = buffer.substr(0, pos);
            buffer.erase(0, pos + 1);

            while (!line.empty() &&
                   (line.back() == '\r' || line.back() == ' ')) {
                line.pop_back();
            }
            if (!line.empty()) {
                parse_json_line(line);
            }
        }
    }

    while (!buffer.empty() &&
           (buffer.back() == '\r' || buffer.back() == '\n' ||
            buffer.back() == ' ')) {
        buffer.pop_back();
    }
    if (!buffer.empty()) {
        parse_json_line(buffer);
    }

    close(fd);

    {
        std::lock_guard<std::mutex> lock(mu_);
        if (child_pid_ > 0) {
            int status;
            waitpid(child_pid_, &status, 0);
            child_pid_ = -1;
        }
    }

    running_.store(false);
}
#endif

// ── JSON parsing ───────────────────────────────────────────────────────────

void ClaudeProcess::parse_json_line(const std::string& line) {
    try {
        json j = json::parse(line);
        ClaudeEvent event;
        const std::string type = j.value("type", "");

        if (type == "system") {
            event.type = ClaudeEvent::SYSTEM;
            event.session_id = j.value("session_id", "");
            std::lock_guard<std::mutex> lock(mu_);
            if (!event.session_id.empty()) session_id_ = event.session_id;
            pending_events_.push_back(std::move(event));
        }
        else if (type == "assistant") {
            // message.content is an array of content blocks:
            //   [{"type":"text","text":"..."}, {"type":"tool_use","name":"...","id":"...","input":{...}}]
            const json msg = j.value("message", json::object());
            const json content_blocks = msg.value("content", json::array());

            for (const auto& block : content_blocks) {
                const std::string block_type = block.value("type", "");
                ClaudeEvent ev;

                if (block_type == "text") {
                    ev.type = ClaudeEvent::TEXT;
                    ev.text = block.value("text", "");
                    std::lock_guard<std::mutex> lock(mu_);
                    pending_events_.push_back(std::move(ev));
                }
                else if (block_type == "tool_use") {
                    ev.type = ClaudeEvent::TOOL_USE;
                    ev.tool_name = block.value("name", "");
                    ev.tool_use_id = block.value("id", "");
                    if (block.contains("input")) {
                        ev.tool_input = block["input"].dump(2);
                    }
                    std::lock_guard<std::mutex> lock(mu_);
                    pending_events_.push_back(std::move(ev));
                }
            }
        }
        else if (type == "tool_result") {
            event.type = ClaudeEvent::TOOL_RESULT;
            event.tool_use_id = j.value("tool_use_id", "");
            if (j.contains("content")) {
                const json& content = j["content"];
                if (content.is_string()) {
                    event.tool_result = content.get<std::string>();
                } else if (content.is_array()) {
                    std::string result;
                    for (const auto& block : content) {
                        if (block.value("type", "") == "text") {
                            if (!result.empty()) result += "\n";
                            result += block.value("text", "");
                        }
                    }
                    event.tool_result = result;
                }
            }
            std::lock_guard<std::mutex> lock(mu_);
            pending_events_.push_back(std::move(event));
        }
        else if (type == "result") {
            event.type = ClaudeEvent::RESULT;
            event.text = j.value("result", "");
            event.cost_usd = j.value("total_cost_usd", 0.0);
            event.session_id = j.value("session_id", "");
            std::lock_guard<std::mutex> lock(mu_);
            if (!event.session_id.empty()) session_id_ = event.session_id;
            pending_events_.push_back(std::move(event));
        }
        // Silently ignore unknown types (e.g. rate_limit_event)
    }
    catch (const json::exception&) {
        ClaudeEvent event;
        event.type = ClaudeEvent::ERROR;
        event.text = line;
        std::lock_guard<std::mutex> lock(mu_);
        pending_events_.push_back(std::move(event));
    }
}

} // namespace misty::core
