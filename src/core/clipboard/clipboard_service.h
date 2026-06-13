#pragma once

#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <atomic>

#include "core/clipboard/clipboard_types.h"
#include "core/clipboard/native_clipboard.h"

namespace misty::core {

class ProxyClipboardClient;

class ClipboardService {
public:
    using ChangeCallback = std::function<void(const ClipboardPayload&)>;

    ClipboardService(std::unique_ptr<NativeClipboard> native_clipboard,
                     ProxyClipboardClient* shared_client);
    ~ClipboardService();

    bool start();
    void stop();

    void set_device_identity(std::string device_id, std::string device_name);
    void set_on_change(ChangeCallback callback);

    ClipboardPayload current_local() const;
    ClipboardPayload latest_shared() const;

    bool publish_current_to_shared();
    bool publish_payload_to_shared(const ClipboardPayload& payload);
    bool apply_shared_to_system();
    bool apply_shared_to_system_async();

    void accept_remote_payload(const ClipboardPayload& payload);

private:
    void on_native_clipboard_changed();
    ClipboardPayload make_text_payload(std::string text, ClipboardOrigin origin);
    ClipboardPayload finalize_payload(ClipboardPayload payload, ClipboardOrigin origin);
    bool apply_payload_to_system(ClipboardPayload payload);
    void set_local_payload(ClipboardPayload payload);
    void set_shared_payload(ClipboardPayload payload);
    static std::string fingerprint_for(const ClipboardPayload& payload);

    mutable std::mutex mu_;
    std::unique_ptr<NativeClipboard> native_clipboard_;
    ProxyClipboardClient* shared_client_ = nullptr;
    ChangeCallback on_change_;
    std::thread apply_thread_;
    std::atomic<bool> apply_in_flight_{false};

    ClipboardPayload local_;
    ClipboardPayload shared_;
    std::string last_seen_fingerprint_;
    std::string device_id_;
    std::string device_name_;
    uint64_t next_revision_ = 1;
};

}  // namespace misty::core
