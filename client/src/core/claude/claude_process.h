#pragma once

#include <atomic>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace misty::core {

/// A single event streamed from the Claude Code CLI (--output-format stream-json).
struct ClaudeEvent {
    enum Type {
        SYSTEM,        // Session init
        TEXT,          // Assistant text fragment
        TOOL_USE,      // Tool invocation
        TOOL_RESULT,   // Tool output
        RESULT,        // Turn complete
        ERROR,         // Error
    };

    Type type = ERROR;
    std::string session_id;    // SYSTEM / RESULT
    std::string text;          // TEXT / RESULT / ERROR
    std::string tool_name;     // TOOL_USE
    std::string tool_input;    // TOOL_USE  (JSON string)
    std::string tool_use_id;   // TOOL_USE / TOOL_RESULT
    std::string tool_result;   // TOOL_RESULT
    double cost_usd = 0.0;    // RESULT
};

/// Manages the `claude` CLI as a subprocess.
///
/// Each call to send_message() spawns:
///   claude -p "<prompt>" --output-format stream-json --verbose
///          [--resume <session_id>]
///
/// Output is read line-by-line on a background thread and parsed into
/// ClaudeEvents that the UI drains every frame.
class ClaudeProcess {
public:
    ClaudeProcess() = default;
    ~ClaudeProcess();

    ClaudeProcess(const ClaudeProcess&) = delete;
    ClaudeProcess& operator=(const ClaudeProcess&) = delete;

    /// True if `claude` is found in PATH.
    static bool is_installed();

    /// Spawn claude for one conversation turn.
    bool send_message(const std::string& prompt,
                      const std::string& cwd,
                      const std::string& session_id = "",
                      const std::map<std::string, std::string>& env_overrides = {});

    bool is_running() const { return running_.load(); }

    /// Thread-safe: move all pending events out.
    std::vector<ClaudeEvent> drain_events();

    /// Kill the running subprocess.
    void abort();

    std::string session_id() const;

private:
    void reader_loop(int fd);
    void parse_json_line(const std::string& line);

    mutable std::mutex mu_;
    std::vector<ClaudeEvent> pending_events_;
    std::string session_id_;
    std::atomic<bool> running_{false};
    std::thread reader_thread_;

#ifndef _WIN32
    pid_t child_pid_ = -1;
#endif
};

} // namespace misty::core
