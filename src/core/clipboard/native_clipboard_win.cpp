#ifdef _WIN32

#include "core/clipboard/native_clipboard.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <atomic>
#include <mutex>
#include <optional>
#include <thread>

namespace misty::core {
namespace {

constexpr wchar_t kClipboardWindowClass[] = L"MistyClipboardListenerWindow";

std::string utf8_from_wide(const wchar_t* value) {
    if (!value) {
        return {};
    }
    const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) {
        return {};
    }
    std::string out(static_cast<size_t>(size - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), size, nullptr, nullptr);
    return out;
}

std::wstring wide_from_utf8(const std::string& value) {
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
    if (size <= 0) {
        return {};
    }
    std::wstring out(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, out.data(), size);
    return out;
}

class WinNativeClipboard final : public NativeClipboard {
public:
    ~WinNativeClipboard() override { stop(); }

    bool start(ChangeCallback on_change) override {
        {
            std::lock_guard<std::mutex> lock(mu_);
            callback_ = std::move(on_change);
        }
        running_.store(true);
        thread_ = std::thread([this]() { message_loop(); });
        return true;
    }

    void stop() override {
        if (!running_.exchange(false)) {
            return;
        }
        if (hwnd_) {
            PostMessageW(hwnd_, WM_CLOSE, 0, 0);
        }
        if (thread_.joinable()) {
            thread_.join();
        }
        std::lock_guard<std::mutex> lock(mu_);
        callback_ = nullptr;
    }

    std::optional<std::string> read_text() const override {
        if (!OpenClipboard(nullptr)) {
            return std::nullopt;
        }
        HANDLE handle = GetClipboardData(CF_UNICODETEXT);
        if (!handle) {
            CloseClipboard();
            return std::nullopt;
        }
        const wchar_t* data = static_cast<const wchar_t*>(GlobalLock(handle));
        std::optional<std::string> result;
        if (data) {
            result = utf8_from_wide(data);
            GlobalUnlock(handle);
        }
        CloseClipboard();
        return result;
    }

    bool write_text(const std::string& text) override {
        const std::wstring wide = wide_from_utf8(text);
        if (wide.empty() || !OpenClipboard(nullptr)) {
            return false;
        }
        EmptyClipboard();
        const size_t bytes = wide.size() * sizeof(wchar_t);
        HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if (!handle) {
            CloseClipboard();
            return false;
        }
        void* data = GlobalLock(handle);
        if (!data) {
            GlobalFree(handle);
            CloseClipboard();
            return false;
        }
        memcpy(data, wide.data(), bytes);
        GlobalUnlock(handle);
        const bool ok = SetClipboardData(CF_UNICODETEXT, handle) != nullptr;
        if (!ok) {
            GlobalFree(handle);
        }
        CloseClipboard();
        return ok;
    }

    bool supported() const override { return true; }

private:
    static LRESULT CALLBACK window_proc(HWND hwnd, UINT msg, WPARAM w_param, LPARAM l_param) {
        auto* self = reinterpret_cast<WinNativeClipboard*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
        if (msg == WM_NCCREATE) {
            auto* create = reinterpret_cast<CREATESTRUCTW*>(l_param);
            self = static_cast<WinNativeClipboard*>(create->lpCreateParams);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        }
        if (self && msg == WM_CLIPBOARDUPDATE) {
            self->notify_change();
            return 0;
        }
        if (msg == WM_CLOSE) {
            DestroyWindow(hwnd);
            return 0;
        }
        if (msg == WM_DESTROY) {
            PostQuitMessage(0);
            return 0;
        }
        return DefWindowProcW(hwnd, msg, w_param, l_param);
    }

    void message_loop() {
        WNDCLASSW wc{};
        wc.lpfnWndProc = window_proc;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.lpszClassName = kClipboardWindowClass;
        RegisterClassW(&wc);

        hwnd_ = CreateWindowExW(0,
                                kClipboardWindowClass,
                                L"Misty Clipboard Listener",
                                0,
                                0,
                                0,
                                0,
                                0,
                                HWND_MESSAGE,
                                nullptr,
                                wc.hInstance,
                                this);
        if (!hwnd_) {
            running_.store(false);
            return;
        }
        AddClipboardFormatListener(hwnd_);

        MSG msg;
        while (running_.load() && GetMessageW(&msg, nullptr, 0, 0) > 0) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        RemoveClipboardFormatListener(hwnd_);
        hwnd_ = nullptr;
    }

    void notify_change() {
        ChangeCallback callback;
        {
            std::lock_guard<std::mutex> lock(mu_);
            callback = callback_;
        }
        if (callback) {
            callback();
        }
    }

    mutable std::mutex mu_;
    ChangeCallback callback_;
    std::atomic<bool> running_{false};
    std::thread thread_;
    HWND hwnd_ = nullptr;
};

}  // namespace

std::unique_ptr<NativeClipboard> create_native_clipboard_win() {
    return std::make_unique<WinNativeClipboard>();
}

}  // namespace misty::core

#endif
