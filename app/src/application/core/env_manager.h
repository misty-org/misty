#pragma once

#include <string>
#include <unordered_map>
#include <optional>

namespace minidfs::core {
    class EnvManager {
    public:
        static EnvManager& get();

        std::string get(const std::string& key) const;

        std::string get(const std::string& key, const std::string& default_value) const;

        std::optional<std::string> get_optional(const std::string& key) const;

        bool has(const std::string& key) const;

        void reload();

        void set_env_file_path(const std::string& path);

    private:
        EnvManager() = default;
        ~EnvManager() = default;
        EnvManager(const EnvManager&) = delete;
        EnvManager& operator=(const EnvManager&) = delete;

        void load_env_file();
        std::string trim(const std::string& str) const;
        std::string unquote(const std::string& str) const;
    
    private:
        std::string env_file_path_ = "";
        std::unordered_map<std::string, std::string> env_;
        bool loaded_ = false;
    };
}
