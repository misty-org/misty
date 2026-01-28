#include "env_manager.h"
#include <cctype>
#include "util.h"

namespace minidfs::core {

    EnvManager& EnvManager::get() {
        static EnvManager instance;
        if (!instance.loaded_) {
            std::string home_dir = get_user_home_dir();
            if (home_dir.empty()) {
                throw std::runtime_error("Could not determine user home directory");
            }
            instance.set_env_file_path(home_dir + "/misty/misty.env");
            instance.load_env_file();
        }
        return instance;
    }

    void EnvManager::set_env_file_path(const std::string& path) {
        env_file_path_ = path;
        loaded_ = false;
        env_.clear();
    }

    void EnvManager::reload() {
        env_.clear();
        loaded_ = false;
        load_env_file();
    }

    std::string EnvManager::get(const std::string& key) const {
        auto it = env_.find(key);
        if (it != env_.end()) {
            return it->second;
        }
        return "";
    }

    std::string EnvManager::get(const std::string& key, const std::string& default_value) const {
        auto it = env_.find(key);
        if (it != env_.end()) {
            return it->second;
        }
        return default_value;
    }

    std::optional<std::string> EnvManager::get_optional(const std::string& key) const {
        auto it = env_.find(key);
        if (it != env_.end()) {
            return it->second;
        }
        return std::nullopt;
    }

    bool EnvManager::has(const std::string& key) const {
        return env_.find(key) != env_.end();
    }

    void EnvManager::load_env_file() {
        if (loaded_) return;

        std::ifstream file(env_file_path_);
        if (!file.is_open()) {
            loaded_ = true;
            return;
        }

        std::string line;
        while (std::getline(file, line)) {
            line = trim(line);

            if (line.empty()) continue;
            if (line[0] == '#') continue;

            size_t eq_pos = line.find('=');
            if (eq_pos == std::string::npos) continue;

            std::string key = trim(line.substr(0, eq_pos));
            std::string value = trim(line.substr(eq_pos + 1));

            if (key.empty()) continue;
            value = unquote(value);

            env_[key] = value;
        }

        file.close();
        loaded_ = true;
    }

    std::string EnvManager::trim(const std::string& str) const {
        if (str.empty()) return str;

        size_t start = 0;
        size_t end = str.length() - 1;

        while (start < str.length() && std::isspace(static_cast<unsigned char>(str[start]))) {
            start++;
        }
        while (end > start && std::isspace(static_cast<unsigned char>(str[end]))) {
            end--;
        }

        if (start > end) return "";
        return str.substr(start, end - start + 1);
    }

    std::string EnvManager::unquote(const std::string& str) const {
        if (str.length() < 2) return str;

        if (str[0] == '"' && str[str.length() - 1] == '"') {
            return str.substr(1, str.length() - 2);
        }

        if (str[0] == '\'' && str[str.length() - 1] == '\'') {
            return str.substr(1, str.length() - 2);
        }

        return str;
    }
}
