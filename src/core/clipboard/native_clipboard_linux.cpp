#ifdef __linux__

#include "core/clipboard/native_clipboard.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <optional>
#include <string>
#include <thread>

namespace misty::core {
namespace {

class LinuxNativeClipboard final : public NativeClipboard {
public:
    ~LinuxNativeClipboard() override { stop(); }

    bool start(ChangeCallback on_change) override {
        if (!supported()) {
            return false;
        }
        callback_ = std::move(on_change);
        running_.store(true);
        last_seen_ = read_text().value_or(std::string{});
        watcher_ = std::thread([this]() { watch_loop(); });
        return true;
    }

    void stop() override {
        if (!running_.exchange(false)) {
            return;
        }
        if (watcher_.joinable()) {
            watcher_.join();
        }
    }

    std::optional<std::string> read_text() const override {
        return read_command("xclip -selection clipboard -out 2>/dev/null");
    }

    bool write_text(const std::string& text) override {
        FILE* pipe = popen("xclip -selection clipboard -in 2>/dev/null", "w");
        if (!pipe) {
            return false;
        }
        const size_t written = fwrite(text.data(), 1, text.size(), pipe);
        const int status = pclose(pipe);
        return written == text.size() && status == 0;
    }

    bool supported() const override {
        return std::getenv("WAYLAND_DISPLAY") == nullptr &&
               std::system("command -v xclip >/dev/null 2>&1") == 0;
    }

private:
    static std::optional<std::string> read_command(const char* command) {
        std::unique_ptr<FILE, decltype(&pclose)> pipe(popen(command, "r"), pclose);
        if (!pipe) {
            return std::nullopt;
        }
        std::string output;
        char buffer[512];
        while (fgets(buffer, sizeof(buffer), pipe.get())) {
            output += buffer;
        }
        return output;
    }

    void watch_loop() {
        while (running_.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            auto text = read_text();
            if (!text.has_value() || *text == last_seen_) {
                continue;
            }
            last_seen_ = *text;
            if (callback_) {
                callback_();
            }
        }
    }

    ChangeCallback callback_;
    std::atomic<bool> running_{false};
    std::thread watcher_;
    std::string last_seen_;
};

}  // namespace

std::unique_ptr<NativeClipboard> create_native_clipboard_linux() {
    return std::make_unique<LinuxNativeClipboard>();
}

}  // namespace misty::core

#endif
