#include <cctype>
#include <fstream>
#include <filesystem>
#include <nlohmann/json.hpp>
#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#elif __APPLE__
#include <pwd.h>
#include <unistd.h>
#elif __linux__
#include <pwd.h>
#include <unistd.h>
#endif

#include "env_manager.h"
#include "core/system/util.h"

namespace fs = std::filesystem;

namespace misty::core {
    EnvManager& EnvManager::get() {
        static EnvManager instance;
        std::call_once(instance.load_flag_, [&]() {
            std::string home_dir = instance.get_user_home_dir();
            if (home_dir.empty()) {
                throw std::runtime_error("Could not determine user home directory");
            }
            instance.set_env_file_path(home_dir + "/misty/config/misty.json");
            instance.load_env_file();
        });
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

    bool EnvManager::has(const std::string& key) const {
        return env_.find(key) != env_.end();
    }

    void EnvManager::load_env_file() {
        if (loaded_) return;

        const fs::path config_path(env_file_path_);
        const bool is_json = config_path.extension() == ".json";

        if (is_json && fs::exists(config_path)) {
            try {
                std::ifstream file(config_path);
                nlohmann::json j = nlohmann::json::parse(file, nullptr, true, true);

                const int proxy_port = j.value("proxy", nlohmann::json::object()).value("port", 0);
                const std::string proxy_url = j.value("proxy", nlohmann::json::object()).value("url", std::string());
                const std::string proxy_path = j.value("proxy", nlohmann::json::object()).value("path", std::string());
                const std::string grpc_address = j.value("grpc", nlohmann::json::object()).value("address", std::string("localhost:50051"));
                const std::string mount_path = j.value("mount", nlohmann::json::object()).value("path", std::string("misty"));
                const std::string server_url = j.value("server", nlohmann::json::object()).value("url", std::string());
                const std::string cert_path = j.value("ssl", nlohmann::json::object()).value("cert_path", std::string());

                if (!proxy_path.empty()) env_["MISTY_PROXY_PATH"] = proxy_path;
                if (!server_url.empty()) env_["MISTY_SERVER_URL"] = server_url;
                if (!cert_path.empty()) env_["SSL_CERT_PATH"] = cert_path;
                env_["MISTY_GRPC_ADDRESS"] = grpc_address;
                env_["MISTY_MOUNT_PATH"] = mount_path;

                if (!proxy_url.empty()) {
                    env_["PROXY_SERVICE_URL"] = proxy_url;
                } else if (proxy_port > 0) {
                    env_["PROXY_SERVICE_URL"] = "http://127.0.0.1:" + std::to_string(proxy_port);
                }

                loaded_ = true;
                return;
            } catch (...) {
            }
        }

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

    std::string EnvManager::get_user_home_dir() {
#ifdef __WIN32
        char path[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_PROFILE, NULL, SHGFP_TYPE_CURRENT, path))) {
            return std::string(path);
        }
        // Fallback to USERPROFILE environment variable
        const char* home = std::getenv("USERPROFILE");
        if (home) {
            return std::string(home);
        }
        return "";
        
#elif __APPLE__ || __linux__
        const char* home = std::getenv("HOME");
        if (home) {
            return std::string(home);
        }
        struct passwd* pw = getpwuid(getuid());
        if (pw && pw->pw_dir) {
            return std::string(pw->pw_dir);
        }
        return "";
#endif

        return "";

    }

    
}
