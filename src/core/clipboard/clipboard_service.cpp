#include "core/clipboard/clipboard_service.h"

#include <chrono>
#include <sstream>
#include <utility>

#include "core/clipboard/proxy_clipboard_client.h"

namespace misty::core {
namespace {

int64_t unix_ms_now() {
    const auto now = std::chrono::system_clock::now().time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
}

}  // namespace

ClipboardService::ClipboardService(std::unique_ptr<NativeClipboard> native_clipboard,
                                   ProxyClipboardClient* shared_client)
    : native_clipboard_(std::move(native_clipboard)),
      shared_client_(shared_client) {}

ClipboardService::~ClipboardService() {
    stop();
}

bool ClipboardService::start() {
    if (!native_clipboard_ || !native_clipboard_->supported()) {
        return false;
    }
    return native_clipboard_->start([this]() { on_native_clipboard_changed(); });
}

void ClipboardService::stop() {
    if (apply_thread_.joinable()) {
        apply_thread_.join();
    }
    if (native_clipboard_) {
        native_clipboard_->stop();
    }
}

void ClipboardService::set_device_identity(std::string device_id, std::string device_name) {
    std::lock_guard<std::mutex> lock(mu_);
    device_id_ = std::move(device_id);
    device_name_ = std::move(device_name);
}

void ClipboardService::set_on_change(ChangeCallback callback) {
    std::lock_guard<std::mutex> lock(mu_);
    on_change_ = std::move(callback);
}

ClipboardPayload ClipboardService::current_local() const {
    std::lock_guard<std::mutex> lock(mu_);
    return local_;
}

ClipboardPayload ClipboardService::latest_shared() const {
    std::lock_guard<std::mutex> lock(mu_);
    return shared_;
}

bool ClipboardService::publish_current_to_shared() {
    return publish_payload_to_shared(current_local());
}

bool ClipboardService::publish_payload_to_shared(const ClipboardPayload& payload) {
    if (!shared_client_ || payload.empty()) {
        return false;
    }
    return shared_client_->publish(payload);
}

bool ClipboardService::apply_shared_to_system() {
    ClipboardPayload shared;
    {
        std::lock_guard<std::mutex> lock(mu_);
        shared = shared_;
    }
    return apply_payload_to_system(std::move(shared));
}

bool ClipboardService::apply_shared_to_system_async() {
    if (apply_in_flight_.exchange(true)) {
        return false;
    }
    if (apply_thread_.joinable()) {
        apply_thread_.join();
    }
    ClipboardPayload shared;
    {
        std::lock_guard<std::mutex> lock(mu_);
        shared = shared_;
    }
    if (shared.empty()) {
        apply_in_flight_.store(false);
        return false;
    }
    apply_thread_ = std::thread([this, payload = std::move(shared)]() mutable {
        (void)apply_payload_to_system(std::move(payload));
        apply_in_flight_.store(false);
    });
    return true;
}

bool ClipboardService::apply_payload_to_system(ClipboardPayload shared) {
    if (!native_clipboard_ || shared.empty()) {
        return false;
    }
    if (shared_client_ && !shared_client_->hydrate_payload(shared)) {
        return false;
    }
    {
        std::lock_guard<std::mutex> lock(mu_);
        last_seen_fingerprint_ = fingerprint_for(shared);
    }
    return native_clipboard_->write_payload(shared);
}

void ClipboardService::accept_remote_payload(const ClipboardPayload& payload) {
    ClipboardPayload remote = payload;
    remote.origin = ClipboardOrigin::RemoteShared;
    set_shared_payload(std::move(remote));
}

void ClipboardService::on_native_clipboard_changed() {
    if (!native_clipboard_) {
        return;
    }
    auto payload = native_clipboard_->read_payload();
    if (!payload.has_value() || payload->empty()) {
        return;
    }
    const std::string fingerprint = fingerprint_for(*payload);
    {
        std::lock_guard<std::mutex> lock(mu_);
        if (fingerprint == last_seen_fingerprint_) {
            return;
        }
        last_seen_fingerprint_ = fingerprint;
    }
    set_local_payload(finalize_payload(std::move(*payload), ClipboardOrigin::LocalSystem));
}

ClipboardPayload ClipboardService::make_text_payload(std::string text, ClipboardOrigin origin) {
    ClipboardPayload payload;
    payload.kind = text.empty() ? ClipboardPayloadKind::Empty : ClipboardPayloadKind::Text;
    payload.text = std::move(text);
    return finalize_payload(std::move(payload), origin);
}

ClipboardPayload ClipboardService::finalize_payload(ClipboardPayload payload, ClipboardOrigin origin) {
    payload.origin = origin;
    payload.created_unix_ms = unix_ms_now();
    {
        std::lock_guard<std::mutex> lock(mu_);
        payload.source_device_id = device_id_;
        payload.source_device_name = device_name_;
        payload.revision = next_revision_++;
    }
    std::ostringstream id;
    id << payload.source_device_id << ":" << payload.revision << ":" << payload.created_unix_ms;
    payload.payload_id = id.str();
    return payload;
}

std::string ClipboardService::fingerprint_for(const ClipboardPayload& payload) {
    std::ostringstream out;
    out << static_cast<int>(payload.kind) << '\n'
        << payload.text << '\n'
        << payload.html << '\n';
    for (const auto& ref : payload.file_refs) {
        out << ref.local_path << '\t'
            << ref.remote_name << '\t'
            << ref.remote_path << '\t'
            << ref.is_dir << '\n';
    }
    for (const auto& image : payload.images) {
        out << image.mime_type << '\t'
            << image.blob_id << '\t'
            << image.checksum << '\t'
            << image.size_bytes << '\t'
            << image.width << 'x' << image.height << '\t'
            << image.bytes.size() << '\n';
        if (!image.bytes.empty()) {
            out.write(reinterpret_cast<const char*>(image.bytes.data()),
                      static_cast<std::streamsize>(image.bytes.size()));
        }
        out << '\n';
    }
    return out.str();
}

void ClipboardService::set_local_payload(ClipboardPayload payload) {
    ChangeCallback callback;
    {
        std::lock_guard<std::mutex> lock(mu_);
        local_ = std::move(payload);
        callback = on_change_;
        payload = local_;
    }
    if (callback) {
        callback(payload);
    }
}

void ClipboardService::set_shared_payload(ClipboardPayload payload) {
    ChangeCallback callback;
    {
        std::lock_guard<std::mutex> lock(mu_);
        shared_ = std::move(payload);
        callback = on_change_;
        payload = shared_;
    }
    if (callback) {
        callback(payload);
    }
}

}  // namespace misty::core
