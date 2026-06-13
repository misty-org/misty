#include "core/clipboard/clipboard_service.h"
#include "core/clipboard/proxy_clipboard_client.h"

#include <gtest/gtest.h>

#include <optional>
#include <string>
#include <utility>

namespace {

class FakeNativeClipboard final : public misty::core::NativeClipboard {
public:
    bool start(ChangeCallback on_change) override {
        callback_ = std::move(on_change);
        started = true;
        return true;
    }

    void stop() override {
        started = false;
        callback_ = nullptr;
    }

    std::optional<std::string> read_text() const override {
        return text;
    }

    bool write_text(const std::string& value) override {
        text = value;
        writes++;
        return true;
    }

    bool supported() const override {
        return true;
    }

    void trigger_change() {
        if (callback_) {
            callback_();
        }
    }

    bool started = false;
    mutable std::string text;
    int writes = 0;

private:
    ChangeCallback callback_;
};

}  // namespace

TEST(ClipboardPayloadTest, EmptyReflectsPayloadKind) {
    misty::core::ClipboardPayload payload;
    EXPECT_TRUE(payload.empty());

    payload.kind = misty::core::ClipboardPayloadKind::Text;
    EXPECT_TRUE(payload.empty());

    payload.text = "hello";
    EXPECT_FALSE(payload.empty());

    payload.kind = misty::core::ClipboardPayloadKind::FileRefs;
    payload.text.clear();
    EXPECT_TRUE(payload.empty());

    payload.file_refs.push_back({.display_name = "notes.txt"});
    EXPECT_FALSE(payload.empty());

    payload = {};
    payload.kind = misty::core::ClipboardPayloadKind::Image;
    EXPECT_TRUE(payload.empty());
    payload.images.push_back({.mime_type = "image/png", .blob_id = "blob-1", .size_bytes = 3});
    EXPECT_FALSE(payload.empty());

    payload = {};
    payload.kind = misty::core::ClipboardPayloadKind::Html;
    payload.html = "<b>hello</b>";
    EXPECT_FALSE(payload.empty());
}

TEST(ClipboardServiceTest, NativeChangeCreatesLocalTextPayload) {
    auto native = std::make_unique<FakeNativeClipboard>();
    auto* raw_native = native.get();
    misty::core::ClipboardService service(std::move(native), nullptr);
    service.set_device_identity("dev-a", "Laptop");

    int changes = 0;
    service.set_on_change([&](const misty::core::ClipboardPayload& payload) {
        changes++;
        EXPECT_EQ(payload.origin, misty::core::ClipboardOrigin::LocalSystem);
    });

    ASSERT_TRUE(service.start());
    raw_native->text = "hello";
    raw_native->trigger_change();

    const auto payload = service.current_local();
    EXPECT_EQ(payload.kind, misty::core::ClipboardPayloadKind::Text);
    EXPECT_EQ(payload.text, "hello");
    EXPECT_EQ(payload.source_device_id, "dev-a");
    EXPECT_EQ(payload.source_device_name, "Laptop");
    EXPECT_EQ(payload.revision, 1u);
    EXPECT_EQ(changes, 1);
}

TEST(ClipboardServiceTest, DuplicateNativeTextIsSuppressed) {
    auto native = std::make_unique<FakeNativeClipboard>();
    auto* raw_native = native.get();
    misty::core::ClipboardService service(std::move(native), nullptr);

    int changes = 0;
    service.set_on_change([&](const misty::core::ClipboardPayload&) {
        changes++;
    });

    ASSERT_TRUE(service.start());
    raw_native->text = "same";
    raw_native->trigger_change();
    raw_native->trigger_change();

    EXPECT_EQ(changes, 1);
    EXPECT_EQ(service.current_local().revision, 1u);
}

TEST(ClipboardServiceTest, RemotePayloadIsStoredUntilManualApply) {
    auto native = std::make_unique<FakeNativeClipboard>();
    auto* raw_native = native.get();
    misty::core::ClipboardService service(std::move(native), nullptr);

    misty::core::ClipboardPayload remote;
    remote.kind = misty::core::ClipboardPayloadKind::Text;
    remote.origin = misty::core::ClipboardOrigin::LocalMisty;
    remote.text = "from another device";
    remote.source_device_id = "dev-b";

    service.accept_remote_payload(remote);
    EXPECT_EQ(service.latest_shared().origin, misty::core::ClipboardOrigin::RemoteShared);
    EXPECT_EQ(raw_native->writes, 0);

    EXPECT_TRUE(service.apply_shared_to_system());
    EXPECT_EQ(raw_native->writes, 1);
    EXPECT_EQ(raw_native->text, "from another device");
}

TEST(ClipboardServiceTest, RemotePayloadCanApplyAsync) {
    auto native = std::make_unique<FakeNativeClipboard>();
    auto* raw_native = native.get();
    misty::core::ClipboardService service(std::move(native), nullptr);

    misty::core::ClipboardPayload remote;
    remote.kind = misty::core::ClipboardPayloadKind::Text;
    remote.text = "async remote";

    service.accept_remote_payload(remote);
    EXPECT_TRUE(service.apply_shared_to_system_async());

    service.stop();
    EXPECT_EQ(raw_native->writes, 1);
    EXPECT_EQ(raw_native->text, "async remote");
}

TEST(ProxyClipboardClientTest, PayloadJsonRoundTripsTextAndFileRefs) {
    misty::core::ClipboardPayload payload;
    payload.kind = misty::core::ClipboardPayloadKind::FileRefs;
    payload.origin = misty::core::ClipboardOrigin::LocalSystem;
    payload.payload_id = "dev-a:3:1000";
    payload.source_device_id = "dev-a";
    payload.source_device_name = "Laptop";
    payload.revision = 3;
    payload.created_unix_ms = 1000;
    payload.file_refs.push_back({
        .display_name = "notes.txt",
        .local_path = "/tmp/notes.txt",
        .remote_name = "drive",
        .remote_path = "/notes.txt",
        .is_dir = false,
    });

    const auto json = misty::core::clipboard_payload_to_json(payload);
    const auto parsed = misty::core::clipboard_payload_from_json(json);

    EXPECT_EQ(parsed.kind, misty::core::ClipboardPayloadKind::FileRefs);
    EXPECT_EQ(parsed.origin, misty::core::ClipboardOrigin::RemoteShared);
    EXPECT_EQ(parsed.payload_id, payload.payload_id);
    ASSERT_EQ(parsed.file_refs.size(), 1u);
    EXPECT_EQ(parsed.file_refs[0].remote_name, "drive");
    EXPECT_EQ(parsed.file_refs[0].local_path, "/tmp/notes.txt");
}

TEST(ProxyClipboardClientTest, PayloadJsonRoundTripsImageMetadataWithoutBytes) {
    misty::core::ClipboardPayload payload;
    payload.kind = misty::core::ClipboardPayloadKind::Image;
    payload.payload_id = "dev-a:4:1000";
    payload.source_device_id = "dev-a";
    payload.source_device_name = "Laptop";
    payload.revision = 4;
    payload.created_unix_ms = 1000;
    payload.images.push_back({
        .mime_type = "image/png",
        .blob_id = "blob-123",
        .checksum = "abc",
        .size_bytes = 3,
        .width = 10,
        .height = 20,
        .bytes = {1, 2, 3},
    });

    const auto json = misty::core::clipboard_payload_to_json(payload);
    const auto parsed = misty::core::clipboard_payload_from_json(json);

    EXPECT_EQ(parsed.kind, misty::core::ClipboardPayloadKind::Image);
    ASSERT_EQ(parsed.images.size(), 1u);
    EXPECT_EQ(parsed.images[0].blob_id, "blob-123");
    EXPECT_EQ(parsed.images[0].mime_type, "image/png");
    EXPECT_EQ(parsed.images[0].checksum, "abc");
    EXPECT_EQ(parsed.images[0].size_bytes, 3u);
    EXPECT_EQ(parsed.images[0].width, 10);
    EXPECT_EQ(parsed.images[0].height, 20);
    EXPECT_TRUE(parsed.images[0].bytes.empty());
}
