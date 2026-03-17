#include "core/clipboard/clipboard_cache.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <optional>

#include <gtest/gtest.h>

namespace {

namespace fs = std::filesystem;

class ScopedHome {
public:
    explicit ScopedHome(const fs::path& home) {
        if (const char* current = std::getenv("HOME")) {
            old_home_ = current;
        }
        setenv("HOME", home.string().c_str(), 1);
    }

    ~ScopedHome() {
        if (old_home_.has_value()) {
            setenv("HOME", old_home_->c_str(), 1);
        } else {
            unsetenv("HOME");
        }
    }

private:
    std::optional<std::string> old_home_;
};

fs::path temp_root(const std::string& name) {
    const fs::path root = fs::temp_directory_path() / (name + "-" + std::to_string(::testing::UnitTest::GetInstance()->random_seed()));
    std::error_code ec;
    fs::remove_all(root, ec);
    fs::create_directories(root, ec);
    return root;
}

void write_file(const fs::path& path, const std::string& body) {
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << body;
}

std::string read_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

misty::core::ClipboardRemoteFileCacheKey remote_key() {
    misty::core::ClipboardRemoteFileCacheKey key;
    key.remote_name = "dropbox-mattdev727";
    key.remote_path = "Projects/List.h";
    key.size = 42;
    key.last_modified = "2026-06-13T01:02:03Z";
    key.is_dir = false;
    return key;
}

misty::core::ClipboardImageBlobCacheKey image_key() {
    misty::core::ClipboardImageBlobCacheKey key;
    key.blob_id = "blob-123";
    key.checksum = "sha256:abc";
    key.size_bytes = 4;
    key.mime_type = "image/png";
    return key;
}

}  // namespace

TEST(ClipboardCacheTest, DefaultRootPrefersMistyTmpUnderHome) {
    const fs::path home = temp_root("misty-cache-home");
    ScopedHome scoped_home(home);

    EXPECT_EQ(misty::core::ClipboardCache::default_root(),
              home / ".misty" / "tmp" / "clipboard-cache" / "v1");
}

TEST(ClipboardCacheTest, RemoteFileKeyIsStableAndMetadataSensitive) {
    auto key = remote_key();
    const std::string first = misty::core::ClipboardCache::remote_file_key(key);
    EXPECT_EQ(first, misty::core::ClipboardCache::remote_file_key(key));

    key.last_modified = "2026-06-14T01:02:03Z";
    EXPECT_NE(first, misty::core::ClipboardCache::remote_file_key(key));
}

TEST(ClipboardCacheTest, ImageBlobKeyIsStableAndMetadataSensitive) {
    auto key = image_key();
    const std::string first = misty::core::ClipboardCache::image_blob_key(key);
    EXPECT_EQ(first, misty::core::ClipboardCache::image_blob_key(key));

    key.checksum = "sha256:def";
    EXPECT_NE(first, misty::core::ClipboardCache::image_blob_key(key));
}

TEST(ClipboardCacheTest, RemoteFileMissStoreAndHit) {
    const fs::path root = temp_root("misty-clipboard-cache-remote");
    misty::core::ClipboardCache cache(root);
    const auto key = remote_key();

    EXPECT_FALSE(cache.lookup_remote_file(key).has_value());

    const fs::path temp = cache.temp_path_for(misty::core::ClipboardCache::remote_file_key(key), "List.h");
    write_file(temp, "payload");
    const auto stored = cache.store_remote_file(key, temp, "List.h");
    ASSERT_TRUE(stored.has_value());
    EXPECT_EQ(read_file(*stored), "payload");

    const auto hit = cache.lookup_remote_file(key);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, *stored);
}

TEST(ClipboardCacheTest, ImageBlobMissStoreAndHit) {
    const fs::path root = temp_root("misty-clipboard-cache-image");
    misty::core::ClipboardCache cache(root);
    const auto key = image_key();
    const std::vector<uint8_t> bytes = {1, 2, 3, 4};

    EXPECT_FALSE(cache.lookup_image_blob(key).has_value());
    ASSERT_TRUE(cache.store_image_blob(key, bytes));

    const auto hit = cache.lookup_image_blob(key);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, bytes);
}

TEST(ClipboardCacheTest, CleanupRemovesExpiredEntriesAndKeepsFreshEntries) {
    const fs::path root = temp_root("misty-clipboard-cache-ttl");
    misty::core::ClipboardCache cache(root);
    const auto base = std::chrono::system_clock::time_point{} + std::chrono::hours(1000);

    auto fresh_key = remote_key();
    auto expired_key = remote_key();
    expired_key.remote_path = "Projects/Old.h";

    cache.set_now_for_tests(base);
    const fs::path fresh_temp = cache.temp_path_for(misty::core::ClipboardCache::remote_file_key(fresh_key), "List.h");
    write_file(fresh_temp, "fresh");
    const auto fresh_path = cache.store_remote_file(fresh_key, fresh_temp, "List.h");
    ASSERT_TRUE(fresh_path.has_value());

    const fs::path expired_temp = cache.temp_path_for(misty::core::ClipboardCache::remote_file_key(expired_key), "Old.h");
    write_file(expired_temp, "expired");
    const auto expired_path = cache.store_remote_file(expired_key, expired_temp, "Old.h");
    ASSERT_TRUE(expired_path.has_value());

    cache.set_now_for_tests(base + std::chrono::hours(2));
    cache.lookup_remote_file(fresh_key);
    cache.set_now_for_tests(base + std::chrono::hours(73));
    cache.cleanup_expired();

    EXPECT_FALSE(cache.lookup_remote_file(expired_key).has_value());
    EXPECT_TRUE(cache.lookup_remote_file(fresh_key).has_value());
}
