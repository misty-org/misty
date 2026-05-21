#include "core/manager/settings_manager.h"

#include <filesystem>
#include <fstream>
#include <mutex>

#include "core/manager/env_manager.h"

namespace misty::core {
namespace {

namespace fs = std::filesystem;

std::mutex& settings_mutex() {
    static std::mutex mu;
    return mu;
}

} // namespace

fs::path settings_path() {
    return fs::path(EnvManager::get().get_user_home_dir()) / ".misty" / "config" / "settings.json";
}

nlohmann::json load_settings_document() {
    std::lock_guard<std::mutex> lock(settings_mutex());

    const fs::path path = settings_path();
    std::ifstream file(path);
    if (!file.is_open()) {
        return nlohmann::json::object();
    }

    try {
        nlohmann::json json;
        file >> json;
        if (json.is_object()) {
            return json;
        }
    } catch (...) {
    }
    return nlohmann::json::object();
}

bool save_settings_document(const nlohmann::json& document, std::string* error) {
    std::lock_guard<std::mutex> lock(settings_mutex());

    const fs::path path = settings_path();
    try {
        fs::create_directories(path.parent_path());
        std::ofstream file(path);
        if (!file.is_open()) {
            if (error) {
                *error = "Failed to open ~/.misty/config/settings.json for writing.";
            }
            return false;
        }
        file << document.dump(2);
        return true;
    } catch (const std::exception& ex) {
        if (error) {
            *error = ex.what();
        }
        return false;
    }
}

bool update_settings_document(const std::function<void(nlohmann::json&)>& updater, std::string* error) {
    std::lock_guard<std::mutex> lock(settings_mutex());

    const fs::path path = settings_path();
    nlohmann::json document = nlohmann::json::object();

    {
        std::ifstream file(path);
        if (file.is_open()) {
            try {
                file >> document;
                if (!document.is_object()) {
                    document = nlohmann::json::object();
                }
            } catch (...) {
                document = nlohmann::json::object();
            }
        }
    }

    if (updater) {
        updater(document);
    }

    try {
        fs::create_directories(path.parent_path());
        std::ofstream file(path);
        if (!file.is_open()) {
            if (error) {
                *error = "Failed to open ~/.misty/config/settings.json for writing.";
            }
            return false;
        }
        file << document.dump(2);
        return true;
    } catch (const std::exception& ex) {
        if (error) {
            *error = ex.what();
        }
        return false;
    }
}

} // namespace misty::core
