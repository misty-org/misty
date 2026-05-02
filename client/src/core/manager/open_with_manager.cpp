#include "core/manager/open_with_manager.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"

namespace fs = std::filesystem;

namespace misty::core {
namespace {

fs::path legacy_open_with_path() {
    return fs::path(EnvManager::get().get_user_home_dir()) / ".misty" / "open_with.json";
}

fs::path settings_path() {
    return fs::path(EnvManager::get().get_user_home_dir()) / "misty" / "config" / "settings.json";
}

nlohmann::json load_settings_document(const fs::path& path) {
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

} // namespace

OpenWithManager& OpenWithManager::get() {
    static OpenWithManager instance;
    return instance;
}

std::optional<std::string> OpenWithManager::association_for_path(const std::string& file_path) {
    std::lock_guard<std::mutex> lock(mu_);
    load_if_needed();

    const std::string key = association_key_for_path(file_path);
    auto it = associations_.find(key);
    if (it == associations_.end() || it->second.empty()) {
        return std::nullopt;
    }

    if (!fs::exists(it->second)) {
        associations_.erase(it);
        save();
        return std::nullopt;
    }

    return it->second;
}

void OpenWithManager::set_association_for_path(const std::string& file_path, const std::string& application_path) {
    std::lock_guard<std::mutex> lock(mu_);
    load_if_needed();
    associations_[association_key_for_path(file_path)] = application_path;
    save();
}

void OpenWithManager::load_if_needed() {
    if (loaded_) {
        return;
    }
    loaded_ = true;

    auto load_associations = [&](const nlohmann::json& json) {
        if (!json.is_object()) {
            return false;
        }
        for (auto it = json.begin(); it != json.end(); ++it) {
            if (it.value().is_string()) {
                associations_[it.key()] = it.value().get<std::string>();
            }
        }
        return true;
    };

    const fs::path path = storage_path();
    nlohmann::json settings = load_settings_document(path);
    const bool has_open_with_settings =
        settings.contains("open_with") && settings["open_with"].is_object();
    if (has_open_with_settings && load_associations(settings["open_with"])) {
        return;
    }

    nlohmann::json legacy = load_settings_document(legacy_open_with_path());
    if (load_associations(legacy)) {
        save();
        std::error_code ec;
        fs::remove(legacy_open_with_path(), ec);
    }
}

void OpenWithManager::save() const {
    const fs::path path(storage_path());
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);

    nlohmann::json open_with = nlohmann::json::object();
    for (const auto& [key, value] : associations_) {
        open_with[key] = value;
    }

    nlohmann::json settings = load_settings_document(path);
    settings["open_with"] = std::move(open_with);

    std::ofstream file(path);
    if (!file.is_open()) {
        return;
    }
    file << settings.dump(2);
}

std::string OpenWithManager::association_key_for_path(const std::string& file_path) const {
    fs::path path(file_path);
    std::string key = path.extension().string();
    if (key.empty()) {
        key = path.filename().string();
    }

    std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return key;
}

std::string OpenWithManager::storage_path() const {
    return settings_path().string();
}

} // namespace misty::core
