#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace misty::core {

struct ClipboardRemoteFileCacheKey {
    std::string remote_name;
    std::string remote_path;
    int64_t size = 0;
    std::string last_modified;
    bool is_dir = false;
};

struct ClipboardImageBlobCacheKey {
    std::string blob_id;
    std::string checksum;
    uint64_t size_bytes = 0;
    std::string mime_type;
};

class ClipboardCache {
public:
    static constexpr int64_t kDefaultTtlHours = 72;

    explicit ClipboardCache(std::filesystem::path root = default_root());

    static std::filesystem::path default_root();
    static std::string remote_file_key(const ClipboardRemoteFileCacheKey& key);
    static std::string image_blob_key(const ClipboardImageBlobCacheKey& key);

    const std::filesystem::path& root() const;

    std::optional<std::filesystem::path> lookup_remote_file(const ClipboardRemoteFileCacheKey& key);
    std::optional<std::vector<uint8_t>> lookup_image_blob(const ClipboardImageBlobCacheKey& key);

    std::filesystem::path temp_path_for(const std::string& key, const std::string& file_name);
    std::optional<std::filesystem::path> store_remote_file(const ClipboardRemoteFileCacheKey& key,
                                                           const std::filesystem::path& temp_path,
                                                           const std::string& file_name);
    bool store_image_blob(const ClipboardImageBlobCacheKey& key,
                          const std::vector<uint8_t>& bytes);

    void cleanup_expired();
    void set_now_for_tests(std::chrono::system_clock::time_point now);

private:
    std::filesystem::path index_path() const;
    std::chrono::system_clock::time_point now() const;
    int64_t now_unix_ms() const;

    std::filesystem::path root_;
    std::optional<std::chrono::system_clock::time_point> now_override_;
};

}  // namespace misty::core
