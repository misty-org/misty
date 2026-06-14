#include "core/clipboard/clipboard_cache.h"

#define XXH_INLINE_ALL
#include "xxhash.h"

#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <system_error>

#include <nlohmann/json.hpp>

namespace misty::core {
namespace {

namespace fs = std::filesystem;

constexpr int64_t kMsPerHour = 60LL * 60LL * 1000LL;

std::string path_string(const fs::path& path) {
    return path.lexically_normal().string();
}

std::string sanitize_file_name(std::string name) {
    if (name.empty() || name == "." || name == "..") {
        return "clipboard-item";
    }
    for (char& c : name) {
        if (c == '/' || c == '\\' || c == ':' || c == '\0') {
            c = '_';
        }
    }
    return name;
}

std::string hex_hash(const std::string& value) {
    const XXH64_hash_t hash = XXH64(value.data(), value.size(), 0);
    std::ostringstream out;
    out << std::hex << std::setw(16) << std::setfill('0') << hash;
    return out.str();
}

nlohmann::json read_index(const fs::path& path) {
    std::ifstream in(path);
    if (!in.is_open()) {
        return nlohmann::json::object();
    }
    const auto json = nlohmann::json::parse(in, nullptr, false);
    if (json.is_discarded() || !json.is_object()) {
        return nlohmann::json::object();
    }
    return json;
}

void write_index(const fs::path& path, const nlohmann::json& index) {
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    const fs::path temp = path.string() + ".tmp";
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        if (!out.is_open()) {
            return;
        }
        out << index.dump(2);
    }
    fs::rename(temp, path, ec);
    if (ec) {
        fs::remove(path, ec);
        fs::rename(temp, path, ec);
    }
}

std::string extension_for_mime(const std::string& mime_type) {
    if (mime_type == "image/jpeg") {
        return ".jpg";
    }
    if (mime_type == "image/webp") {
        return ".webp";
    }
    if (mime_type == "image/gif") {
        return ".gif";
    }
    return ".png";
}

bool path_under_root(const fs::path& root, const fs::path& candidate) {
    std::error_code ec;
    const fs::path normalized_root = fs::weakly_canonical(root, ec);
    const fs::path normalized_candidate = fs::weakly_canonical(candidate, ec);
    if (normalized_root.empty() || normalized_candidate.empty()) {
        return false;
    }
    auto root_it = normalized_root.begin();
    auto candidate_it = normalized_candidate.begin();
    for (; root_it != normalized_root.end(); ++root_it, ++candidate_it) {
        if (candidate_it == normalized_candidate.end() || *root_it != *candidate_it) {
            return false;
        }
    }
    return true;
}

}  // namespace

ClipboardCache::ClipboardCache(fs::path root)
    : root_(std::move(root)) {}

fs::path ClipboardCache::default_root() {
    if (const char* home = std::getenv("HOME"); home && *home) {
        return fs::path(home) / ".misty" / "tmp" / "clipboard-cache" / "v1";
    }
    return fs::temp_directory_path() / "misty" / "clipboard-cache" / "v1";
}

std::string ClipboardCache::remote_file_key(const ClipboardRemoteFileCacheKey& key) {
    std::ostringstream input;
    input << "remote-file\n"
          << key.remote_name << '\n'
          << key.remote_path << '\n'
          << key.size << '\n'
          << key.last_modified << '\n'
          << key.is_dir << '\n';
    return hex_hash(input.str());
}

std::string ClipboardCache::image_blob_key(const ClipboardImageBlobCacheKey& key) {
    std::ostringstream input;
    input << "image-blob\n"
          << key.blob_id << '\n'
          << key.checksum << '\n'
          << key.size_bytes << '\n'
          << key.mime_type << '\n';
    return hex_hash(input.str());
}

const fs::path& ClipboardCache::root() const {
    return root_;
}

std::optional<fs::path> ClipboardCache::lookup_remote_file(const ClipboardRemoteFileCacheKey& key) {
    cleanup_expired();
    const std::string cache_key = remote_file_key(key);
    auto index = read_index(index_path());
    auto& entries = index["entries"];
    if (!entries.is_object() || !entries.contains(cache_key)) {
        return std::nullopt;
    }
    auto& entry = entries[cache_key];
    if (entry.value("type", std::string{}) != "remote_file") {
        return std::nullopt;
    }
    const fs::path path = entry.value("path", std::string{});
    std::error_code ec;
    if (path.empty() || !fs::exists(path, ec) || ec) {
        entries.erase(cache_key);
        write_index(index_path(), index);
        return std::nullopt;
    }
    entry["last_access_unix_ms"] = now_unix_ms();
    write_index(index_path(), index);
    return path;
}

std::optional<std::vector<uint8_t>> ClipboardCache::lookup_image_blob(const ClipboardImageBlobCacheKey& key) {
    cleanup_expired();
    const std::string cache_key = image_blob_key(key);
    auto index = read_index(index_path());
    auto& entries = index["entries"];
    if (!entries.is_object() || !entries.contains(cache_key)) {
        return std::nullopt;
    }
    auto& entry = entries[cache_key];
    if (entry.value("type", std::string{}) != "image_blob") {
        return std::nullopt;
    }
    const fs::path path = entry.value("path", std::string{});
    std::ifstream in(path, std::ios::binary);
    if (!in.is_open()) {
        entries.erase(cache_key);
        write_index(index_path(), index);
        return std::nullopt;
    }
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(in)),
                               std::istreambuf_iterator<char>());
    if (bytes.empty()) {
        return std::nullopt;
    }
    entry["last_access_unix_ms"] = now_unix_ms();
    write_index(index_path(), index);
    return bytes;
}

fs::path ClipboardCache::temp_path_for(const std::string& key, const std::string& file_name) {
    std::error_code ec;
    const fs::path dir = root_ / "partial";
    fs::create_directories(dir, ec);
    return dir / (key + "-" + sanitize_file_name(file_name) + ".partial");
}

std::optional<fs::path> ClipboardCache::store_remote_file(const ClipboardRemoteFileCacheKey& key,
                                                          const fs::path& temp_path,
                                                          const std::string& file_name) {
    if (key.is_dir) {
        return std::nullopt;
    }
    cleanup_expired();
    const std::string cache_key = remote_file_key(key);
    const fs::path dir = root_ / "remote-files" / cache_key;
    const fs::path final_path = dir / sanitize_file_name(file_name);

    std::error_code ec;
    fs::create_directories(dir, ec);
    if (ec) {
        return std::nullopt;
    }
    fs::remove(final_path, ec);
    fs::rename(temp_path, final_path, ec);
    if (ec) {
        fs::copy_file(temp_path, final_path, fs::copy_options::overwrite_existing, ec);
        if (ec) {
            return std::nullopt;
        }
        fs::remove(temp_path, ec);
    }

    auto index = read_index(index_path());
    index["version"] = 1;
    auto& entry = index["entries"][cache_key];
    const int64_t now_ms = now_unix_ms();
    entry = {
        {"type", "remote_file"},
        {"path", path_string(final_path)},
        {"created_unix_ms", now_ms},
        {"last_access_unix_ms", now_ms},
        {"ttl_hours", kDefaultTtlHours},
    };
    write_index(index_path(), index);
    return final_path;
}

bool ClipboardCache::store_image_blob(const ClipboardImageBlobCacheKey& key,
                                      const std::vector<uint8_t>& bytes) {
    if (bytes.empty()) {
        return false;
    }
    cleanup_expired();
    const std::string cache_key = image_blob_key(key);
    const fs::path dir = root_ / "image-blobs";
    const fs::path final_path = dir / (cache_key + extension_for_mime(key.mime_type));
    const fs::path temp_path = dir / (cache_key + ".partial");

    std::error_code ec;
    fs::create_directories(dir, ec);
    if (ec) {
        return false;
    }
    {
        std::ofstream out(temp_path, std::ios::binary | std::ios::trunc);
        if (!out.is_open()) {
            return false;
        }
        out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        if (!out.good()) {
            return false;
        }
    }
    fs::remove(final_path, ec);
    fs::rename(temp_path, final_path, ec);
    if (ec) {
        fs::remove(temp_path, ec);
        return false;
    }

    auto index = read_index(index_path());
    index["version"] = 1;
    auto& entry = index["entries"][cache_key];
    const int64_t now_ms = now_unix_ms();
    entry = {
        {"type", "image_blob"},
        {"path", path_string(final_path)},
        {"created_unix_ms", now_ms},
        {"last_access_unix_ms", now_ms},
        {"ttl_hours", kDefaultTtlHours},
    };
    write_index(index_path(), index);
    return true;
}

void ClipboardCache::cleanup_expired() {
    auto index = read_index(index_path());
    auto& entries = index["entries"];
    if (!entries.is_object()) {
        return;
    }

    const int64_t now_ms = now_unix_ms();
    const int64_t ttl_ms = kDefaultTtlHours * kMsPerHour;
    bool changed = false;
    for (auto it = entries.begin(); it != entries.end();) {
        const int64_t last_access = it.value().value("last_access_unix_ms", int64_t{0});
        const fs::path path = it.value().value("path", std::string{});
        std::error_code ec;
        const bool missing = path.empty() || !fs::exists(path, ec) || ec;
        const bool expired = last_access <= 0 || now_ms - last_access > ttl_ms;
        if (missing || expired) {
            if (!path.empty() && path_under_root(root_, path)) {
                if (it.value().value("type", std::string{}) == "remote_file") {
                    fs::remove_all(path.parent_path(), ec);
                } else {
                    fs::remove(path, ec);
                }
            }
            it = entries.erase(it);
            changed = true;
        } else {
            ++it;
        }
    }
    if (changed) {
        write_index(index_path(), index);
    }
}

void ClipboardCache::set_now_for_tests(std::chrono::system_clock::time_point now) {
    now_override_ = now;
}

fs::path ClipboardCache::index_path() const {
    return root_ / "index.json";
}

std::chrono::system_clock::time_point ClipboardCache::now() const {
    return now_override_.value_or(std::chrono::system_clock::now());
}

int64_t ClipboardCache::now_unix_ms() const {
    const auto duration = now().time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
}

}  // namespace misty::core
