#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace misty::core {

enum class ClipboardPayloadKind { Empty, Text, Html, Image, FileRefs };
enum class ClipboardOrigin { LocalSystem, LocalMisty, RemoteShared };

struct ClipboardFileRef {
    std::string display_name;
    std::string local_path;
    std::string remote_name;
    std::string remote_path;
    bool is_dir = false;
};

struct ClipboardImage {
    std::string mime_type = "image/png";
    std::string blob_id;
    std::string checksum;
    uint64_t size_bytes = 0;
    int width = 0;
    int height = 0;
    std::vector<uint8_t> bytes;
};

struct ClipboardPayload {
    ClipboardPayloadKind kind = ClipboardPayloadKind::Empty;
    ClipboardOrigin origin = ClipboardOrigin::LocalMisty;
    std::string payload_id;
    std::string source_device_id;
    std::string source_device_name;
    uint64_t revision = 0;
    int64_t created_unix_ms = 0;
    std::string text;
    std::string html;
    std::vector<ClipboardFileRef> file_refs;
    std::vector<ClipboardImage> images;

    bool empty() const;
};

}  // namespace misty::core
