#pragma once

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

// listing_cache: simple on-disk cache for remote folder listings, used for
// stale-while-revalidate rendering in the file explorer.
//
// Layout: ~/misty/.cache/remotes/<remote_name>/<encoded_path>.json
//
// The remote_path is URL-style encoded so '/' becomes %2F, keeping every
// listing in a flat per-remote directory and avoiding file/directory name
// collisions (e.g. caching both "Documents" and "Documents/Work").

namespace misty::core::listing_cache {

    namespace fs = std::filesystem;

    inline std::string root_dir() {
        const char* home = std::getenv("HOME");
        if (!home) home = ".";
        return std::string(home) + "/misty/.cache/remotes";
    }

    inline std::string legacy_root_dir() {
        const char* home = std::getenv("HOME");
        if (!home) home = ".";
        return std::string(home) + "/misty/.cache/listings";
    }

    // URL-style encode a path so it survives as a single filename component.
    inline std::string encode_path(const std::string& path) {
        if (path.empty()) return "__root__";
        std::ostringstream out;
        out << std::hex << std::uppercase;
        for (unsigned char c : path) {
            bool safe = (c >= 'a' && c <= 'z') ||
                        (c >= 'A' && c <= 'Z') ||
                        (c >= '0' && c <= '9') ||
                        c == '-' || c == '.' || c == '_' || c == '~';
            if (safe) {
                out << static_cast<char>(c);
            } else {
                out << '%';
                if (c < 0x10) out << '0';
                out << static_cast<int>(c);
            }
        }
        return out.str();
    }

    inline std::string remote_dir(const std::string& remote) {
        return root_dir() + "/" + remote;
    }

    inline std::string file_for(const std::string& remote, const std::string& path) {
        return remote_dir(remote) + "/" + encode_path(path) + ".json";
    }

    inline std::string legacy_file_for(const std::string& remote, const std::string& path) {
        return legacy_root_dir() + "/" + remote + "/" + encode_path(path) + ".json";
    }

    // Returns true on hit; out_body receives the cached JSON body verbatim.
    inline bool load(const std::string& remote, const std::string& path, std::string& out_body) {
        if (remote.empty()) return false;
        std::ifstream f(file_for(remote, path), std::ios::binary);
        if (!f) {
            f.open(legacy_file_for(remote, path), std::ios::binary);
        }
        if (!f) return false;
        std::ostringstream ss;
        ss << f.rdbuf();
        out_body = ss.str();
        return !out_body.empty();
    }

    inline void save(const std::string& remote, const std::string& path, const std::string& body) {
        if (remote.empty() || body.empty()) return;
        std::error_code ec;
        fs::create_directories(remote_dir(remote), ec);
        std::ofstream f(file_for(remote, path), std::ios::binary | std::ios::trunc);
        if (f) f.write(body.data(), static_cast<std::streamsize>(body.size()));
    }

    // Best-effort: nuke a remote's entire cache (e.g. when the remote is
    // disconnected). Failures are silent.
    inline void clear_remote(const std::string& remote) {
        if (remote.empty()) return;
        std::error_code ec;
        fs::remove_all(remote_dir(remote), ec);
    }

    inline void clear(const std::string& remote, const std::string& path) {
        if (remote.empty()) return;
        std::error_code ec;
        fs::remove(file_for(remote, path), ec);
    }

}
