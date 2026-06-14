#include "core/clipboard/proxy_clipboard_client.h"

#include <sstream>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/clipboard/clipboard_cache.h"
#include "core/manager/env_manager.h"
#include "core/net/http_client.h"

namespace misty::core {
namespace {

std::string kind_to_json(ClipboardPayloadKind kind) {
    switch (kind) {
        case ClipboardPayloadKind::Text:
            return "text";
        case ClipboardPayloadKind::Html:
            return "html";
        case ClipboardPayloadKind::Image:
            return "image";
        case ClipboardPayloadKind::FileRefs:
            return "file_refs";
        case ClipboardPayloadKind::Empty:
            return "empty";
    }
    return "empty";
}

ClipboardPayloadKind kind_from_json(const std::string& kind) {
    if (kind == "text") {
        return ClipboardPayloadKind::Text;
    }
    if (kind == "file_refs") {
        return ClipboardPayloadKind::FileRefs;
    }
    if (kind == "html") {
        return ClipboardPayloadKind::Html;
    }
    if (kind == "image") {
        return ClipboardPayloadKind::Image;
    }
    return ClipboardPayloadKind::Empty;
}

std::string trim_trailing_slashes(std::string value) {
    while (!value.empty() && value.back() == '/') {
        value.pop_back();
    }
    return value;
}

}  // namespace

ProxyClipboardClient::ProxyClipboardClient(std::string device_id, std::string device_name)
    : device_id_(std::move(device_id)),
      device_name_(std::move(device_name)) {}

ProxyClipboardClient::~ProxyClipboardClient() {
    stop();
}

bool ProxyClipboardClient::register_device() {
    nlohmann::json body = {
        {"device_id", device_id_},
        {"device_name", device_name_},
    };
    HttpRequestOptions options;
    options.headers["Content-Type"] = "application/json";
    const auto response = HTTPClient::get().post(endpoint("/api/clipboard/register"), body.dump(), options);
    return response.status_code >= 200 && response.status_code < 300;
}

void ProxyClipboardClient::start(RemoteClipboardCallback on_clipboard) {
    if (running_.exchange(true)) {
        return;
    }
    register_device();
    stream_thread_ = std::thread(&ProxyClipboardClient::stream_loop, this, std::move(on_clipboard));
}

void ProxyClipboardClient::stop() {
    if (!running_.exchange(false)) {
        return;
    }
    if (stream_thread_.joinable()) {
        stream_thread_.join();
    }
}

bool ProxyClipboardClient::publish(const ClipboardPayload& payload) {
    if (payload.empty()) {
        return false;
    }
    ClipboardPayload publish_payload = payload;
    for (auto& image : publish_payload.images) {
        if (image.blob_id.empty() && !image.bytes.empty() && !upload_image_blob(image)) {
            return false;
        }
    }
    HttpRequestOptions options;
    options.headers["Content-Type"] = "application/json";
    const auto response = HTTPClient::get().post(
        endpoint("/api/clipboard/publish"),
        clipboard_payload_to_json(publish_payload),
        options);
    return response.status_code >= 200 && response.status_code < 300;
}

bool ProxyClipboardClient::hydrate_payload(ClipboardPayload& payload) {
    for (auto& image : payload.images) {
        if (image.bytes.empty() && !image.blob_id.empty() && !download_image_blob(image)) {
            return false;
        }
    }
    return true;
}

std::string ProxyClipboardClient::endpoint(const std::string& path) const {
    const std::string base = trim_trailing_slashes(
        EnvManager::get().get("PROXY_SERVICE_URL", ""));
    if (base.empty()) {
        return path;
    }
    return base + path;
}

void ProxyClipboardClient::stream_loop(RemoteClipboardCallback on_clipboard) {
    while (running_.load()) {
        std::string event_name;
        std::string data;
        HttpRequestOptions options;
        options.timeouts.total_timeout_seconds = 5L;
        (void)HTTPClient::get().get_stream(
            endpoint("/api/clipboard/stream?device_id=" + url_encode(device_id_)),
            [&](const std::string& line) {
                if (!running_.load()) {
                    return false;
                }
                if (line.rfind("event:", 0) == 0) {
                    event_name = line.substr(6);
                    while (!event_name.empty() && event_name.front() == ' ') {
                        event_name.erase(event_name.begin());
                    }
                    return true;
                }
                if (line.rfind("data:", 0) == 0) {
                    data = line.substr(5);
                    while (!data.empty() && data.front() == ' ') {
                        data.erase(data.begin());
                    }
                    if (event_name == "clipboard" && !data.empty()) {
                        if (on_clipboard) {
                            on_clipboard(clipboard_payload_from_json(data));
                        }
                        event_name.clear();
                        data.clear();
                    }
                    return true;
                }
                return true;
            },
            options);
    }
}

bool ProxyClipboardClient::upload_image_blob(ClipboardImage& image) {
    HttpRequestOptions options;
    options.headers["Content-Type"] = image.mime_type.empty() ? "application/octet-stream" : image.mime_type;
    if (!image.checksum.empty()) {
        options.headers["X-Misty-Blob-Checksum"] = image.checksum;
    }
    const std::string body(reinterpret_cast<const char*>(image.bytes.data()), image.bytes.size());
    const auto response = HTTPClient::get().post(endpoint("/api/clipboard/blobs"), body, options);
    if (response.status_code < 200 || response.status_code >= 300) {
        return false;
    }
    const auto json = nlohmann::json::parse(response.body, nullptr, false);
    if (json.is_discarded()) {
        return false;
    }
    image.blob_id = json.value("blob_id", std::string{});
    image.mime_type = json.value("mime_type", image.mime_type);
    image.size_bytes = json.value("size_bytes", static_cast<uint64_t>(image.bytes.size()));
    image.checksum = json.value("checksum", image.checksum);
    return !image.blob_id.empty();
}

bool ProxyClipboardClient::download_image_blob(ClipboardImage& image) {
    if (image.blob_id.empty()) {
        return false;
    }
    ClipboardImageBlobCacheKey cache_key;
    cache_key.blob_id = image.blob_id;
    cache_key.checksum = image.checksum;
    cache_key.size_bytes = image.size_bytes;
    cache_key.mime_type = image.mime_type;
    ClipboardCache cache;
    if (auto cached = cache.lookup_image_blob(cache_key); cached.has_value()) {
        image.bytes = std::move(*cached);
        if (image.size_bytes == 0) {
            image.size_bytes = image.bytes.size();
        }
        return !image.bytes.empty();
    }

    const auto response = HTTPClient::get().get(endpoint("/api/clipboard/blobs/" + url_encode(image.blob_id)));
    if (response.status_code < 200 || response.status_code >= 300) {
        return false;
    }
    image.bytes.assign(response.body.begin(), response.body.end());
    if (image.size_bytes == 0) {
        image.size_bytes = image.bytes.size();
    }
    (void)cache.store_image_blob(cache_key, image.bytes);
    return !image.bytes.empty();
}

std::string clipboard_payload_to_json(const ClipboardPayload& payload) {
    nlohmann::json body;
    body["payload_id"] = payload.payload_id;
    body["kind"] = kind_to_json(payload.kind);
    body["source_device_id"] = payload.source_device_id;
    body["source_device_name"] = payload.source_device_name;
    body["revision"] = payload.revision;
    body["created_unix_ms"] = payload.created_unix_ms;
    body["text"] = payload.text;
    body["html"] = payload.html;
    body["file_refs"] = nlohmann::json::array();
    for (const auto& ref : payload.file_refs) {
        body["file_refs"].push_back({
            {"display_name", ref.display_name},
            {"local_path", ref.local_path},
            {"remote_name", ref.remote_name},
            {"remote_path", ref.remote_path},
            {"is_dir", ref.is_dir},
        });
    }
    body["images"] = nlohmann::json::array();
    for (const auto& image : payload.images) {
        body["images"].push_back({
            {"mime_type", image.mime_type},
            {"blob_id", image.blob_id},
            {"checksum", image.checksum},
            {"size_bytes", image.size_bytes == 0 ? static_cast<uint64_t>(image.bytes.size()) : image.size_bytes},
            {"width", image.width},
            {"height", image.height},
        });
    }
    return body.dump();
}

ClipboardPayload clipboard_payload_from_json(const std::string& body) {
    const auto json = nlohmann::json::parse(body);
    ClipboardPayload payload;
    payload.kind = kind_from_json(json.value("kind", "empty"));
    payload.origin = ClipboardOrigin::RemoteShared;
    payload.payload_id = json.value("payload_id", std::string{});
    payload.source_device_id = json.value("source_device_id", std::string{});
    payload.source_device_name = json.value("source_device_name", std::string{});
    payload.revision = json.value("revision", uint64_t{0});
    payload.created_unix_ms = json.value("created_unix_ms", int64_t{0});
    payload.text = json.value("text", std::string{});
    payload.html = json.value("html", std::string{});
    for (const auto& item : json.value("file_refs", nlohmann::json::array())) {
        ClipboardFileRef ref;
        ref.display_name = item.value("display_name", std::string{});
        ref.local_path = item.value("local_path", std::string{});
        ref.remote_name = item.value("remote_name", std::string{});
        ref.remote_path = item.value("remote_path", std::string{});
        ref.is_dir = item.value("is_dir", false);
        payload.file_refs.push_back(std::move(ref));
    }
    for (const auto& item : json.value("images", nlohmann::json::array())) {
        ClipboardImage image;
        image.mime_type = item.value("mime_type", std::string{"image/png"});
        image.blob_id = item.value("blob_id", std::string{});
        image.checksum = item.value("checksum", std::string{});
        image.size_bytes = item.value("size_bytes", uint64_t{0});
        image.width = item.value("width", 0);
        image.height = item.value("height", 0);
        payload.images.push_back(std::move(image));
    }
    return payload;
}

}  // namespace misty::core
