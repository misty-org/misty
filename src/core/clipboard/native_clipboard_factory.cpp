#include "core/clipboard/native_clipboard_factory.h"

#include <utility>

namespace misty::core {
namespace {

class UnsupportedNativeClipboard final : public NativeClipboard {
public:
    bool start(ChangeCallback) override { return false; }
    void stop() override {}
    std::optional<std::string> read_text() const override { return std::nullopt; }
    bool write_text(const std::string&) override { return false; }
    bool supported() const override { return false; }
};

}  // namespace

#if defined(__APPLE__)
std::unique_ptr<NativeClipboard> create_native_clipboard_mac();
#elif defined(_WIN32)
std::unique_ptr<NativeClipboard> create_native_clipboard_win();
#elif defined(__linux__)
std::unique_ptr<NativeClipboard> create_native_clipboard_linux();
#endif

std::unique_ptr<NativeClipboard> create_native_clipboard() {
#if defined(__APPLE__)
    return create_native_clipboard_mac();
#elif defined(_WIN32)
    return create_native_clipboard_win();
#elif defined(__linux__)
    return create_native_clipboard_linux();
#else
    return std::make_unique<UnsupportedNativeClipboard>();
#endif
}

}  // namespace misty::core
