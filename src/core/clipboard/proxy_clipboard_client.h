#pragma once

#include <atomic>
#include <functional>
#include <string>
#include <thread>

#include "core/clipboard/clipboard_types.h"

namespace misty::core {

class ProxyClipboardClient {
public:
    using RemoteClipboardCallback = std::function<void(const ClipboardPayload&)>;

    ProxyClipboardClient(std::string device_id, std::string device_name);
    ~ProxyClipboardClient();

    bool register_device();
    void start(RemoteClipboardCallback on_clipboard);
    void stop();
    bool publish(const ClipboardPayload& payload);
    bool hydrate_payload(ClipboardPayload& payload);

private:
    std::string endpoint(const std::string& path) const;
    void stream_loop(RemoteClipboardCallback on_clipboard);
    bool upload_image_blob(ClipboardImage& image);
    bool download_image_blob(ClipboardImage& image);

    std::string device_id_;
    std::string device_name_;
    std::atomic<bool> running_{false};
    std::thread stream_thread_;
};

std::string clipboard_payload_to_json(const ClipboardPayload& payload);
ClipboardPayload clipboard_payload_from_json(const std::string& body);

}  // namespace misty::core
